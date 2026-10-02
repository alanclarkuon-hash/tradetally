jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn(),createSyncLog:jest.fn(),updateSyncLog:jest.fn(),updateAfterFailure:jest.fn(),scheduleTransientRetry:jest.fn()}));
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
