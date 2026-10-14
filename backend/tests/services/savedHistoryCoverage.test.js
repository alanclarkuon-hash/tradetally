jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/utils/historicalPriceCache',()=>({getRange:jest.fn()}));
jest.mock('axios',()=>({get:jest.fn()}));
const db=require('../../src/config/database'),cache=require('../../src/utils/historicalPriceCache');
const {remaining}=require('../../src/services/savedHistoryCoverage');
const gap={symbol:'SYNTH',instrumentType:'stock',calendar:'US',from:'2026-01-05',to:'2026-01-06',ranges:[{from:'2026-01-05',to:'2026-01-06'}]};
const candle=day=>({time:Date.parse(day)/1000,close:10});
beforeEach(()=>{jest.clearAllMocks();db.query.mockResolvedValue({rows:[]});cache.getRange.mockResolvedValue([]);});
test('removes a stale gap when canonical saved closes now cover it without downloads or writes',async()=>{
 cache.getRange.mockResolvedValue([candle('2026-01-05'),candle('2026-01-06')]);
 expect(await remaining(gap)).toBeNull();
 expect(require('axios').get).not.toHaveBeenCalled();
 expect(db.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);
});
test('retains only genuinely absent sessions',async()=>{
 cache.getRange.mockResolvedValue([candle('2026-01-05')]);
 expect((await remaining(gap)).ranges).toEqual([{from:'2026-01-06',to:'2026-01-06'}]);
});
test('reuses raw prices only with native USD or saved dated FX and excludes proxy dates',async()=>{
 db.query.mockImplementation(async q=>({rows:q.includes('portfolio_reconstruction_prices')?[{payload:{currency:'EUR',prices:[{date:'2026-01-05',close:10},{date:'2026-01-06',close:11}]}}]:[{rate_date:'2026-01-05',rates:{EUR:0.9}}]}));
 expect((await remaining(gap)).ranges).toEqual([{from:'2026-01-06',to:'2026-01-06'}]);
 expect(require('axios').get).not.toHaveBeenCalled();
});
test('proxy and invalid raw closes cannot hide missing actual prices',async()=>{
 db.query.mockResolvedValue({rows:[{payload:{currency:'USD',proxyDates:['2026-01-05'],prices:[{date:'2026-01-05',close:10},{date:'2026-01-06',close:0}]}}]});
 expect((await remaining(gap)).ranges).toEqual(gap.ranges);
});
test('keeps equity and crypto namespaces separate and crypto holidays required',async()=>{
 const coin={...gap,symbol:'SYNTH',instrumentType:'crypto',from:'2026-01-01',to:'2026-01-01',ranges:[{from:'2026-01-01',to:'2026-01-01'}]};
 expect((await remaining(coin)).ranges).toEqual(coin.ranges);
 expect(cache.getRange).toHaveBeenCalledWith('crypto:SYNTH','2026-01-01','2026-01-01');
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining('portfolio_reconstruction_prices'),['SYNTH-USD']);
});
test('unsupported broker contracts remain explicit without consulting security prices',async()=>{
 const contract={...gap,unsupported:true};expect(await remaining(contract)).toBe(contract);expect(cache.getRange).not.toHaveBeenCalled();
});
