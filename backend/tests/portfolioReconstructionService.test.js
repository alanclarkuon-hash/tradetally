jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioDashboardService',()=>({FIAT:new Set(['USD','GBP']),STABLE:new Set(['USDT'])}));
jest.mock('../src/utils/quoteCurrency',()=>({normaliseMinorUnit:c=>c==='GBp'?{code:'GBP',divisor:100}:c?{code:c,divisor:1}:null}));
const {walletHistory,valueQuantities,parseYahoo,historicalPrice,replayShares}=require('../src/services/portfolioReconstructionService');
test('native ledger replay preserves fees, tiny rewards and non-additive Earn transfers',()=>{
 const events=[{wallet:'XXBT',time:Date.parse('2025-01-01'),amount:'1',fee:'0.01'},
  {wallet:'XXBT',time:Date.parse('2025-01-02'),amount:'-0.5',fee:'0'},
  {wallet:'XXBT.S',time:Date.parse('2025-01-02'),amount:'0.5',fee:'0'},
  {wallet:'XXBT.S',time:Date.parse('2025-01-03'),amount:'0.00000001',fee:'0'}];
 const rows=walletHistory(events,'2025-01-01','2025-01-03');
 expect(rows[0].quantities.BTC).toBeCloseTo(.99,10);
 expect(rows[1].quantities.BTC).toBeCloseTo(.99,10);
 expect(rows[2].quantities.BTC).toBeCloseTo(.99000001,10);
});
test('stablecoins and fiat cash are separate; missing prices invalidate the whole account day',()=>{
 const result=valueQuantities({BTC:2,USDT:10,GBP:20},'2025-01-01',s=>s==='BTC'?100:1,s=>s==='GBP'?1.25:1);
 expect(result).toMatchObject({holdings_usd:200,cash_usd:25,stablecoins_usd:10,issues:[]});
 expect(valueQuantities({BTC:1,MISSING:2},'2025-01-01',()=>null,()=>1).holdings_usd).toBeNull();
 expect(valueQuantities({BTC:-1},'2025-01-01',()=>100,()=>1).holdings_usd).toBeNull();
});
test('explicit zero-price mode keeps known values and records estimates without zeroing invalid cash or quantities',()=>{
 const value=valueQuantities({BTC:2,MISSING:3,GBP:20},'2025-01-01',s=>s==='BTC'?100:null,()=>1.25,{zeroMissingPrices:true});
 expect(value).toMatchObject({holdings_usd:200,cash_usd:25,stablecoins_usd:0,
 issues:['Estimated at zero: missing historical price for MISSING']});
 expect(valueQuantities({BTC:-1},'2025-01-01',()=>100,()=>1,{zeroMissingPrices:true}).holdings_usd).toBeNull();
 expect(valueQuantities({GBP:20},'2025-01-01',()=>100,()=>null,{zeroMissingPrices:true}).cash_usd).toBeNull();
});
test('dated exchange closes cover a weekend but never a long price outage or a crypto missing day',()=>{
 const series={prices:[{date:'2025-01-03',close:10}]};
 expect(historicalPrice(series,'2025-01-05')).toBe(10);
 expect(historicalPrice(series,'2025-01-12')).toBeNull();
 expect(historicalPrice(series,'2025-01-04',true)).toBeNull();
});
test('unadjusts split-normalized prices and pence without introducing dividend total returns',()=>{
 const series=parseYahoo({meta:{currency:'GBp'},timestamp:[Date.parse('2025-01-01')/1000,Date.parse('2025-01-03')/1000],
  indicators:{quote:[{close:[500,600]}],adjclose:[{adjclose:[400,500]}]},events:{splits:{s:{date:Date.parse('2025-01-02')/1000,numerator:2,denominator:1}}}});
 expect(series.currency).toBe('GBP');expect(series.prices.map(p=>p.close)).toEqual([10,6]);
 expect(()=>parseYahoo({meta:{},timestamp:[]})).toThrow('currency');
});
test('replays quantities on split dates and keeps a buy/sell pair from becoming repeated holdings',()=>{
 const rows=replayShares([{date:'2025-01-01',symbol:'TEST',quantity:3},{date:'2025-01-02',symbol:'TEST',quantity:-2}],
  [{date:'2025-01-02',symbol:'TEST',ratio:2}],'2025-01-01','2025-01-03');
 expect(rows.map(r=>r.quantities.TEST)).toEqual([3,4,4]);
});
