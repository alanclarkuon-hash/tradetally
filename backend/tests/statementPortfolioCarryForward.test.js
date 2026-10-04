const {carryForward}=require('../src/services/statementPortfolioCarryForward');
const accounts=[{account_identifier:'ig',broker:'ig',currency:'GBP'},
 {account_identifier:'etoro',broker:'etoro',currency:'USD'},
 {account_identifier:'other',broker:'kraken',currency:'USD'}];
const row=(account,date,total,source='statement')=>({account_identifier:account,value_date:date,holdings_usd:total==null?null:total*.6,cash_usd:total==null?null:total*.4,stablecoins_usd:total==null?null:0,gbp_per_usd:.8,source});
test('creates absent calendar days, preserves native balances and isolates manual accounts',()=>{
 const input=[row('ig','2026-01-01',100),row('etoro','2026-01-01',100),row('other','2026-01-01',100)];
 const result=carryForward(input,accounts,new Map([['2026-01-02',.5]]),'2026-01-02');
 expect(result.find(r=>r.account_identifier==='ig'&&r.value_date==='2026-01-02')).toMatchObject({holdings_usd:96,cash_usd:64,carryForwardFrom:'2026-01-01'});
 expect(result.find(r=>r.account_identifier==='etoro'&&r.value_date==='2026-01-02')).toMatchObject({holdings_usd:60,cash_usd:40,carryForwardFrom:'2026-01-01'});
 expect(result.filter(r=>r.account_identifier==='other')).toHaveLength(1);
 expect(input).toHaveLength(3);
});
test('statement backfill replaces estimates and becomes the next carry seed',()=>{
 const fx=new Map(['01','02','03','04'].map(d=>['2026-01-'+d,.8]));
 const original=[row('etoro','2026-01-01',100),row('etoro','2026-01-03',null)];
 expect(carryForward(original,accounts,fx,'2026-01-04').at(-1).cash_usd).toBe(40);
 const actual=row('etoro','2026-01-03',200);
 const result=carryForward([original[0],actual],accounts,fx,'2026-01-04');
 expect(result.find(r=>r.value_date==='2026-01-03')).toEqual(actual);
 expect(result.at(-1)).toMatchObject({cash_usd:80,carryForwardFrom:'2026-01-03'});
});
test('retains live eToro observations and never invents pre-history or missing FX',()=>{
 const actual=row('etoro','2026-01-03',150,'recorded');
 const result=carryForward([row('etoro','2026-01-02',100),actual],accounts,new Map(),'2026-01-04');
 expect(result).toHaveLength(2);expect(result[1]).toEqual(actual);
 expect(result.some(r=>r.value_date==='2026-01-01')).toBe(false);
});
