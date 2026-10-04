jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioReconstructionService',()=>({reconstruct:jest.fn()}));
jest.mock('../src/services/portfolioValueHistoryService',()=>({captureToday:jest.fn()}));
jest.mock('../src/services/brokerSync/ibkrNavHistory',()=>({backfillTrailingWeekends:jest.fn()}));
const db=require('../src/config/database'),reconstruction=require('../src/services/portfolioReconstructionService'),capture=require('../src/services/portfolioValueHistoryService');
const {maintain}=require('../src/services/brokerPortfolioMaintenance');
const account={account_identifier:'owned',broker:'trading212',initial_balance_date:'2024-01-01'};
beforeEach(()=>{
 jest.resetAllMocks();
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('user_accounts')?[account]:[{latest:'2026-10-01'}]}));
 capture.captureToday.mockResolvedValue({captured:1,warnings:[]});
 reconstruction.reconstruct.mockResolvedValue([{broker:'trading212',days:3,gaps:0}]);
});
test('recovers only owned broker dates with an overlap, then captures the fresh value',async()=>{
 const result=await maintain('owner',{broker:'trading212',fetchPrices:false});
 expect(reconstruction.reconstruct).toHaveBeenCalledWith('owner',expect.objectContaining({accountIdentifiers:['owned'],fromDate:'2026-09-29',apply:true,fetchPrices:false}));
 expect(capture.captureToday).toHaveBeenCalledWith('owner',{accounts:'owned'});
 expect(result).toMatchObject({captured:1,warnings:[]});
});
test('a historical price failure retains broker imports and reports a sanitized warning',async()=>{
 reconstruction.reconstruct.mockRejectedValue(Error('private details must not be printed'));
 const result=await maintain('owner',{broker:'trading212'});
 expect(result.warnings.join(' ')).toContain('backfill could not finish');
 expect(result.warnings.join(' ')).not.toContain('private details');
 expect(result.captured).toBe(1);
});
test('unmanaged brokers cannot accidentally capture all accounts',async()=>{
 expect(await maintain('owner',{broker:'etoro'})).toEqual({captured:0,rebuilt:[],warnings:[]});
 expect(capture.captureToday).not.toHaveBeenCalled();
});
test('Kraken history cannot be rebuilt from an unreconciled snapshot',async()=>{
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('user_accounts')?[{...account,broker:'kraken'}]:[{payload:{reconciled:false}}]}));
 const result=await maintain('owner',{broker:'kraken'});
 expect(reconstruction.reconstruct).not.toHaveBeenCalled();expect(result.warnings[0]).toContain('reconciliation');
});
test('IBKR retains reported NAV instead of trying to price derivative history',async()=>{
 db.query.mockResolvedValue({rows:[{...account,broker:'ibkr'}]});
 await maintain('owner',{broker:'ibkr'});
 expect(reconstruction.reconstruct).not.toHaveBeenCalled();
 expect(require('../src/services/brokerSync/ibkrNavHistory').backfillTrailingWeekends).toHaveBeenCalled();
});


test('OKX spot history gets the same bounded recovery, while unreconciled wallets are blocked',async()=>{
 const api={...account,broker:'okx'};
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('user_accounts')?[api]:sql.includes('broker_import_snapshots')?[{payload:{historyComplete:true,funding:[],positions:[]}}]:[{latest:'2026-10-01'}]}));
 reconstruction.reconstruct.mockResolvedValue([{broker:'okx',days:3,gaps:0}]);
 await maintain('owner',{broker:'okx',fetchPrices:false});
 expect(reconstruction.reconstruct).toHaveBeenCalledWith('owner',expect.objectContaining({broker:'okx',accountIdentifiers:['owned'],fetchPrices:false}));
 reconstruction.reconstruct.mockClear();
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('user_accounts')?[api]:[{payload:{historyComplete:false}}]}));
 expect((await maintain('owner',{broker:'okx'})).warnings[0]).toContain('reconciliation');
 expect(reconstruction.reconstruct).not.toHaveBeenCalled();
});
