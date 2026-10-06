jest.mock('../src/services/portfolioReconstructionService',()=>({reconstruct:jest.fn()}));
const {reconstruct}=require('../src/services/portfolioReconstructionService');
const {rebuild}=require('../src/services/manualPortfolioMaintenance');
beforeEach(()=>jest.resetAllMocks());
test('backfills only the selected manual broker accounts using confirmed imports',async()=>{
 reconstruct.mockResolvedValue([{days:3,gaps:0}]);
 expect(await rebuild('owner','ig',['selected'],'2026-01-01')).toEqual({failed:false,rebuilt:3,warnings:[]});
 expect(reconstruct).toHaveBeenCalledWith('owner',{broker:'ig',accountIdentifiers:['selected'],fromDate:'2026-01-01',fetchPrices:true,apply:true,zeroMissingPrices:true});
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
