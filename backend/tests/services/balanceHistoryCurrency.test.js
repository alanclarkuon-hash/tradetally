const {balanceHistoryCurrency}=require('../../src/services/balanceHistoryCurrency');
test('converts each native currency before combining account balances',()=>{
 const result=balanceHistoryCurrency([{snapshot_date:'2026-01-01',iso_currency_code:'GBP',current_balance:80,available_balance:40,account_count:1},{snapshot_date:'2026-01-01',iso_currency_code:'EUR',current_balance:90,available_balance:90,account_count:1},{snapshot_date:'2026-01-01',iso_currency_code:'USD',current_balance:100,available_balance:100,account_count:1}],{GBP:.8,EUR:.9});
 expect(result).toMatchObject({currency:'USD',series:[{date:'2026-01-01',currentBalance:300,availableBalance:250,accountCount:3,missingFx:0}],coverage:{sourceCurrencies:['GBP','EUR','USD']}});
});
test('unknown currencies and missing rates never masquerade as USD or zero balances',()=>{
 const rows=[{snapshot_date:'2026-01-01',iso_currency_code:'USD',current_balance:100,account_count:1},{snapshot_date:'2026-01-01',iso_currency_code:null,current_balance:50,account_count:1},{snapshot_date:'2026-01-02',iso_currency_code:'EUR',current_balance:90,account_count:1}];
 const result=balanceHistoryCurrency(rows,{EUR:0});
 expect(result.series.map(p=>p.currentBalance)).toEqual([null,null]);expect(result.coverage.missingFx).toBe(2);expect(rows[0].current_balance).toBe(100);
});
test('preserves zero and negative balances and distinguishes unavailable amounts',()=>{
 const result=balanceHistoryCurrency([{snapshot_date:'2026-01-01',iso_currency_code:'GBP',current_balance:-8,available_balance:0,account_count:1},{snapshot_date:'2026-01-02',iso_currency_code:'USD',current_balance:null,available_balance:null,account_count:1}],{GBP:.8});
 expect(result.series[0]).toMatchObject({currentBalance:-10,availableBalance:0});expect(result.series[1].currentBalance).toBeNull();
});
