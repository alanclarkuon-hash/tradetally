const {carryForward}=require('../src/services/igPortfolioCarryForward');
const accounts=[{account_identifier:'spread',is_ig_spread:true},{account_identifier:'shares',is_ig_spread:false}];
const row=(account,date,cash)=>({account_identifier:account,value_date:date,holdings_usd:cash==null?null:0,cash_usd:cash,stablecoins_usd:cash==null?null:0,gbp_per_usd:.8,source:'statement'});
test('fills only confirmed IG spread gaps, preserving native GBP and actual observations',()=>{
 const rows=[row('spread','2026-01-01',100),row('spread','2026-01-02',null),row('shares','2026-01-02',null),row('spread','2026-01-03',200)];
 const result=carryForward(rows,accounts,new Map([['2026-01-02',.5]]));
 expect(result[1]).toMatchObject({cash_usd:160,gbp_per_usd:.5,source:'reconstructed',issues:[expect.stringContaining('2026-01-01')]});
 expect(result[2].cash_usd).toBeNull();expect(result[3]).toEqual(rows[3]);
 expect(rows[1].cash_usd).toBeNull();
});
test('does not backfill before a known balance or invent exchange rates',()=>{
 const rows=[row('spread','2026-01-01',null),row('spread','2026-01-02',100),row('spread','2026-01-03',null)];
 const withoutFx=rows.map(r=>({...r,gbp_per_usd:r.cash_usd==null?null:r.gbp_per_usd}));
 expect(carryForward(withoutFx,accounts,new Map())).toEqual(withoutFx);
});
test('uses the most recent dated rate across non-reporting days without future rates',()=>{
 const rows=[row('spread','2026-01-02',100),{...row('spread','2026-01-03',null),gbp_per_usd:null}];
 const result=carryForward(rows,accounts,new Map([['2026-01-02',.8],['2026-01-04',.5]]));
 expect(result[1]).toMatchObject({cash_usd:100,gbp_per_usd:.8});
});
