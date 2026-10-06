jest.mock('../../src/services/historyBackfillService',()=>({enqueue:jest.fn().mockResolvedValue('history-job')}));
jest.mock('../../src/services/brokerPortfolioMaintenance',()=>({maintain:jest.fn()}));
jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn(),createSyncLog:jest.fn(),updateSyncLog:jest.fn(),updateAfterFailure:jest.fn(),scheduleTransientRetry:jest.fn(),updateAfterSync:jest.fn()}));
jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/tierService',()=>({canSyncBrokerConnection:jest.fn().mockResolvedValue({allowed:true})}));
jest.mock('../../src/services/brokerSync/ibkrService',()=>({syncTrades:jest.fn()}));
jest.mock('../../src/services/brokerSync/schwabService',()=>({}));
jest.mock('../../src/services/brokerSync/trading212Service',()=>({}));
jest.mock('../../src/services/brokerSync/tradestationService',()=>({}));
jest.mock('../../src/services/brokerSync/alpacaService',()=>({}));
const service=require('../../src/services/brokerSync');
const BC=require('../../src/models/BrokerConnection');
const db=require('../../src/config/database');
const ibkr=require('../../src/services/brokerSync/ibkrService');
beforeEach(()=>{jest.clearAllMocks();service.activeSyncs.clear();BC.findById.mockResolvedValue({id:'connection',userId:'owner',brokerType:'ibkr',connectionStatus:'active',syncStartDate:'2024-01-01'});BC.createSyncLog.mockResolvedValue({id:'log'});ibkr.syncTrades.mockRejectedValue(Object.assign(new Error('Blocked'),{errorCode:'1025',transient:false}));});
afterEach(()=>jest.restoreAllMocks());
test('a manual and scheduled sync cannot run together for the same connection',async()=>{
  let finish;
  const run=jest.spyOn(service,'runConnectionSync').mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const first=service.syncConnection('connection',{syncType:'manual'});
  expect(await service.syncConnection('connection',{syncType:'scheduled'})).toMatchObject({alreadyRunning:true,success:false});
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
 BC.updateSyncLog.mockImplementation(async(_id,status)=>events.push(status));
 require('../../src/services/historyBackfillService').enqueue.mockImplementation(async()=>{events.push('history');return 'history-job';});
 ibkr.syncTrades.mockResolvedValue({imported:0,skipped:0,failed:0,duplicates:0,outcome:'success',warnings:[]});
 jest.spyOn(service,'closeExpiredOptions').mockResolvedValue(0);
 const result=await service.syncConnection('connection');
 expect(result.success).toBe(true);expect(result.historyJobId).toBe('history-job');
 expect(events.indexOf('completed')).toBeLessThan(events.indexOf('history'));
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
