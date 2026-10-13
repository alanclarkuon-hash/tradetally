jest.mock('../../src/services/brokerSync/syncRecovery',()=>({acquire:jest.fn(),recoverConnection:jest.fn().mockResolvedValue(0)}));
jest.mock('../../src/services/historyBackfillService',()=>({enqueue:jest.fn().mockResolvedValue('history-job')}));
jest.mock('../../src/services/brokerPortfolioMaintenance',()=>({maintain:jest.fn(),captureCurrent:jest.fn().mockResolvedValue({captured:1,rebuilt:[],warnings:[]})}));
jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn(),createSyncLog:jest.fn(),updateSyncLog:jest.fn(),updateSyncProgress:jest.fn(),updateAfterFailure:jest.fn(),scheduleTransientRetry:jest.fn(),updateAfterSync:jest.fn()}));
jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/tierService',()=>({canSyncBrokerConnection:jest.fn().mockResolvedValue({allowed:true})}));
jest.mock('../../src/services/brokerSync/ibkrService',()=>({syncTrades:jest.fn()}));
jest.mock('../../src/services/brokerSync/etoroService',()=>({syncTrades:jest.fn()}));
jest.mock('../../src/services/brokerSync/schwabService',()=>({}));
jest.mock('../../src/services/brokerSync/trading212Service',()=>({}));
jest.mock('../../src/services/brokerSync/tradestationService',()=>({}));
jest.mock('../../src/services/brokerSync/alpacaService',()=>({}));
const service=require('../../src/services/brokerSync');
const BC=require('../../src/models/BrokerConnection');
const db=require('../../src/config/database');
const ibkr=require('../../src/services/brokerSync/ibkrService');
beforeEach(()=>{jest.clearAllMocks();require('../../src/services/brokerSync/syncRecovery').acquire.mockResolvedValue({client:{},release:jest.fn().mockResolvedValue()});service.activeSyncs.clear();BC.findById.mockResolvedValue({id:'connection',userId:'owner',brokerType:'ibkr',connectionStatus:'active',syncStartDate:'2024-01-01'});BC.createSyncLog.mockResolvedValue({id:'log'});ibkr.syncTrades.mockRejectedValue(Object.assign(new Error('Blocked'),{errorCode:'1025',transient:false}));});
afterEach(()=>jest.restoreAllMocks());
test('a manual and scheduled sync cannot run together for the same connection',async()=>{
  let finish;
  const run=jest.spyOn(service,'runConnectionSync').mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const first=service.syncConnection('connection',{syncType:'manual'});
  expect(await service.syncConnection('connection',{syncType:'scheduled'})).toMatchObject({alreadyRunning:true,success:false});
  await Promise.resolve();await Promise.resolve();
  expect(run).toHaveBeenCalledTimes(1);
  finish({success:true});await first;expect(service.activeSyncs.size).toBe(0);
});
test('the concurrent-sync guard is released on errors',async()=>{
  jest.spyOn(service,'runConnectionSync').mockRejectedValue(new Error('Failure'));
  await expect(service.syncConnection('connection')).rejects.toThrow('Failure');
  expect(service.activeSyncs.size).toBe(0);
});
test('IBKR 1025 immediately stops automatic retries instead of leaving the connection overdue',async()=>{
  const result=await service.syncConnection('connection',{syncType:'scheduled'});
  expect(result.success).toBe(false);
  expect(BC.updateAfterFailure).toHaveBeenCalledWith('connection','Blocked',{haltAutoRetries:true});
  expect(BC.scheduleTransientRetry).not.toHaveBeenCalled();
});
test('an unconfigured IBKR date floor uses the owner managed-account opening date',async()=>{
  BC.findById.mockResolvedValue({id:'connection',userId:'owner',brokerType:'ibkr',connectionStatus:'active'});
  db.query.mockResolvedValue({rows:[{opening_date:'2024-02-01'}]});
  await service.syncConnection('connection');
  expect(db.query.mock.calls[0][1]).toEqual(['owner']);
  expect(ibkr.syncTrades).toHaveBeenCalledWith(expect.any(Object),expect.objectContaining({startDate:'2024-02-01'}));
});


test('successful imports commit before history is queued and do not wait for chart reconstruction',async()=>{
 const events=[];
 // A running history job may remain blocked on provider downloads indefinitely.
 require('../../src/services/brokerPortfolioMaintenance').maintain.mockImplementation(()=>new Promise(()=>{}));
 BC.updateSyncLog.mockImplementation(async(_id,status)=>events.push(status));
 require('../../src/services/historyBackfillService').enqueue.mockImplementation(async()=>{events.push('history');return 'history-job';});
 ibkr.syncTrades.mockResolvedValue({imported:0,skipped:0,failed:0,duplicates:0,outcome:'success',warnings:[]});
 jest.spyOn(service,'closeExpiredOptions').mockResolvedValue(0);
 const result=await service.syncConnection('connection');
 expect(result.success).toBe(true);expect(result.historyJobId).toBe('history-job');
 expect(events.indexOf('completed')).toBeLessThan(events.indexOf('history'));
 expect(require('../../src/services/brokerPortfolioMaintenance').captureCurrent).toHaveBeenCalledWith('owner',{broker:'ibkr'});
 expect(require('../../src/services/brokerPortfolioMaintenance').maintain).not.toHaveBeenCalled();
 expect(ibkr.syncTrades).toHaveBeenCalledTimes(1);
});

test('history queue failure does not mark a successfully imported broker sync as failed',async()=>{
 require('../../src/services/historyBackfillService').enqueue.mockRejectedValue(Error('private error'));
 ibkr.syncTrades.mockResolvedValue({imported:1,skipped:0,failed:0,duplicates:0,warnings:[]});
 jest.spyOn(service,'closeExpiredOptions').mockResolvedValue(0);
 const result=await service.syncConnection('connection');
 expect(result.success).toBe(true);expect(result.warnings.join(' ')).not.toContain('private error');
 expect(result.warnings.join(' ')).toContain('could not be queued');
 expect(BC.updateAfterFailure).not.toHaveBeenCalled();
});

test('an active database lock blocks a second worker before logging or broker calls',async()=>{
 const recovery=require('../../src/services/brokerSync/syncRecovery');recovery.acquire.mockResolvedValue(null);
 const run=jest.spyOn(service,'runConnectionSync');expect(await service.syncConnection('connection')).toMatchObject({alreadyRunning:true});
 expect(run).not.toHaveBeenCalled();expect(BC.createSyncLog).not.toHaveBeenCalled();expect(service.activeSyncs.size).toBe(0);
});
test('a retry recovers abandoned logs before starting and releases the database lock',async()=>{
 const recovery=require('../../src/services/brokerSync/syncRecovery'),lease={client:{},release:jest.fn()};recovery.acquire.mockResolvedValue(lease);
 const run=jest.spyOn(service,'runConnectionSync').mockResolvedValue({success:true});await service.syncConnection('connection');
 expect(recovery.recoverConnection).toHaveBeenCalledWith(lease.client,'connection');expect(recovery.recoverConnection.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);expect(lease.release).toHaveBeenCalled();
});

 test.each([false,true])('eToro post-sync capture runs without waiting for historical maintenance; capture failure=%s',async fails=>{
 const maintenance=require('../../src/services/brokerPortfolioMaintenance');
 BC.findById.mockResolvedValue({id:'connection',userId:'owner',brokerType:'etoro',connectionStatus:'active',syncStartDate:'2024-01-01'});
 db.query.mockResolvedValue({rows:[]});
 require('../../src/services/brokerSync/etoroService').syncTrades.mockResolvedValue({imported:0,skipped:0,failed:0,duplicates:0,warnings:[]});
 require('../../src/services/historyBackfillService').enqueue.mockResolvedValue('history-job');
 if(fails)maintenance.captureCurrent.mockRejectedValueOnce(Error('private capture failure'));
 else maintenance.captureCurrent.mockResolvedValueOnce({captured:1,rebuilt:[],warnings:[]});
 const r=await service.syncConnection('connection');
 expect(r.success).toBe(true);expect(maintenance.captureCurrent).toHaveBeenCalledWith('owner',{broker:'etoro'});
 expect(maintenance.maintain).not.toHaveBeenCalled();expect(BC.updateAfterFailure).not.toHaveBeenCalled();
 if(fails){expect(r.warnings.join(' ')).toContain('chart maintenance');expect(r.warnings.join(' ')).not.toContain('private capture failure')}
 else expect(r.portfolioHistory.captured).toBe(1);
 });
