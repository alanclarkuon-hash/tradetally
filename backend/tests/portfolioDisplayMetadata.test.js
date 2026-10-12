jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/utils/yahooFinance',()=>({getSymbolProfile:jest.fn()}));
jest.mock('../src/services/fundCategoriesService',()=>({getCategories:jest.fn()}));
let db,yahoo,funds,service;
beforeEach(()=>{jest.resetModules();db=require('../src/config/database');yahoo=require('../src/utils/yahooFinance');funds=require('../src/services/fundCategoriesService');db.query.mockResolvedValue({rows:[]});service=require('../src/services/portfolioDisplayMetadata');});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('cold reads return without awaiting providers and coalesce concurrent refreshes',async()=>{
 let finish;yahoo.getSymbolProfile.mockReturnValue(new Promise(resolve=>{finish=resolve}));
 const first=await service.getDisplayMetadata(['DEMO']);
 expect(first).toEqual({records:new Map(),updating:true});
 await service.getDisplayMetadata(['DEMO']);expect(yahoo.getSymbolProfile).toHaveBeenCalledTimes(1);
 finish({symbol:'DEMO',quoteType:'EQUITY',industry:'Software'});await tick();
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO portfolio_display_metadata'),['DEMO',expect.objectContaining({industry:'Software'}),null]);
});
test('fresh persisted fund identity and categories survive a process restart without any provider request',async()=>{
 const saved={symbol:'FUND.L',profile:{symbol:'FUND.L',quoteType:'ETF'},fund_categories:{primaryCategory:'Technology',categories:['Fund Category: Technology']},fetched_at:new Date().toISOString()};
 db.query.mockResolvedValue({rows:[saved]});
 const result=await service.getDisplayMetadata(['FUND.L']);
 expect(result.records.get('FUND.L')).toEqual(saved);expect(result.updating).toBe(false);expect(yahoo.getSymbolProfile).not.toHaveBeenCalled();expect(funds.getCategories).not.toHaveBeenCalled();
});
test('failed refresh keeps stale metadata and prevents immediate retry storms',async()=>{
 const saved={symbol:'OLD.L',profile:{quoteType:'ETF'},fund_categories:{primaryCategory:'Technology'},fetched_at:'2020-01-01'};
 db.query.mockResolvedValue({rows:[saved]});yahoo.getSymbolProfile.mockRejectedValue(Error('offline'));
 expect((await service.getDisplayMetadata(['OLD.L'])).records.get('OLD.L')).toEqual(saved);await tick();
 await service.getDisplayMetadata(['OLD.L']);expect(yahoo.getSymbolProfile).toHaveBeenCalledTimes(1);expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
});
test('provider identities must exactly match including exchange suffix',async()=>{
 yahoo.getSymbolProfile.mockResolvedValue({symbol:'DEMO',quoteType:'ETF'});
 await service.getDisplayMetadata(['DEMO.L']);await tick();
 expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);expect(funds.getCategories).not.toHaveBeenCalled();
});
test('background refresh concurrency is limited to four and queued symbols stay marked updating',async()=>{
 const resolvers=[];yahoo.getSymbolProfile.mockImplementation(()=>new Promise(resolve=>resolvers.push(resolve)));
 expect((await service.getDisplayMetadata(['A','B','C','D','E'])).updating).toBe(true);expect(yahoo.getSymbolProfile).toHaveBeenCalledTimes(4);
 resolvers[0](null);await tick();expect(yahoo.getSymbolProfile).toHaveBeenCalledTimes(5);
 for(const resolve of resolvers)resolve(null);await tick();
});
