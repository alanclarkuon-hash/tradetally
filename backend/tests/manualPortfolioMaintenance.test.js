jest.mock('../src/services/portfolioReconstructionService',()=>({reconstruct:jest.fn()}));
jest.mock('../src/services/historyBackfillService',()=>({enqueue:jest.fn()}));
const {reconstruct}=require('../src/services/portfolioReconstructionService');
const {rebuild}=require('../src/services/manualPortfolioMaintenance');
beforeEach(()=>{jest.resetAllMocks();require('../src/services/historyBackfillService').enqueue.mockResolvedValue('history-job');});
test('backfills only the selected manual broker accounts using confirmed imports',async()=>{
 reconstruct.mockResolvedValue([{days:3,gaps:0}]);
 expect(await rebuild('owner','ig',['selected'],'2026-01-01')).toEqual({failed:false,historyJobId:'history-job',rebuilt:3,warnings:[]});
 expect(reconstruct).toHaveBeenCalledWith('owner',{broker:'ig',accountIdentifiers:['selected'],fromDate:'2026-01-01',fetchPrices:false,apply:true,zeroMissingPrices:true});
 expect(require('../src/services/historyBackfillService').enqueue).toHaveBeenCalledWith('owner',{accounts:{selected:'2026-01-01'}});
});
test('failed reconstruction returns a sanitized warning without undoing the statement import',async()=>{
 reconstruct.mockRejectedValue(Error('private upstream details'));
 const result=await rebuild('owner','etoro',['selected'],'2026-01-01');
 expect(result.failed).toBe(true);expect(result.rebuilt).toBe(0);expect(result.warnings[0]).toContain('were saved');
 expect(JSON.stringify(result)).not.toContain('private upstream');
});
test('successful reconstruction with coverage gaps is not a maintenance failure',async()=>{
 reconstruct.mockResolvedValue([{days:3,gaps:1}]);
 const result=await rebuild('owner','ig',['selected'],'2026-01-01');
 expect(result.failed).toBe(false);expect(result.rebuilt).toBe(3);expect(result.warnings[0]).toContain('estimated or unavailable');
});

test('queues durable history even when immediate reconstruction fails',async()=>{reconstruct.mockRejectedValue(Error('private'));const r=await rebuild('owner','etoro',['selected'],'2026-01-01');expect(r.historyJobId).toBe('history-job');expect(require('../src/services/historyBackfillService').enqueue).toHaveBeenCalledWith('owner',{accounts:{selected:'2026-01-01'}});});
test('queue failure does not undo a successful import or reveal private errors',async()=>{reconstruct.mockResolvedValue([{days:3,gaps:0}]);require('../src/services/historyBackfillService').enqueue.mockRejectedValue(Error('private'));const r=await rebuild('owner','etoro',['selected'],'2026-01-01');expect(r.failed).toBe(false);expect(r.rebuilt).toBe(3);expect(r.warnings[0]).toContain('could not be queued');expect(JSON.stringify(r)).not.toContain('private');});

test('durable import maintenance retains the exact account set and affected date',async()=>{
 reconstruct.mockResolvedValue([{days:2,gaps:0}]);
 await rebuild('owner','etoro',['first','second'],'2026-10-01');
 expect(require('../src/services/historyBackfillService').enqueue).toHaveBeenCalledWith('owner',{accounts:{first:'2026-10-01',second:'2026-10-01'}});
});
test('an unspecified start date requests full history only for imported accounts',async()=>{
 reconstruct.mockResolvedValue([{days:2,gaps:0}]);await rebuild('owner','ig',['selected']);
 expect(require('../src/services/historyBackfillService').enqueue).toHaveBeenCalledWith('owner',{accounts:{selected:null}});
});
