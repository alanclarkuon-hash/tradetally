jest.mock('../src/services/portfolioService',()=>({createDailySnapshotsForAllUsers:jest.fn().mockResolvedValue({usersProcessed:1})}));
jest.mock('../src/services/portfolioValueHistoryService',()=>({captureAllUsers:jest.fn()}));
jest.mock('../src/services/brokerPortfolioMaintenance',()=>({maintainAllUsers:jest.fn()}));
const scheduler=require('../src/services/portfolioSnapshotScheduler');
const history=require('../src/services/portfolioValueHistoryService'),maintenance=require('../src/services/brokerPortfolioMaintenance');
beforeEach(()=>jest.clearAllMocks());
test('daily job and manual run maintain chart history without a browser visit',async()=>{
 await scheduler.onTick();await scheduler.runNow();
 expect(history.captureAllUsers).toHaveBeenCalledTimes(2);
 expect(maintenance.maintainAllUsers).toHaveBeenCalledTimes(2);
});
test('historical manual snapshot never stamps live values onto that date',async()=>{
 await scheduler.runNow('2020-01-01');
 expect(history.captureAllUsers).not.toHaveBeenCalled();
 expect(maintenance.maintainAllUsers).not.toHaveBeenCalled();
});
