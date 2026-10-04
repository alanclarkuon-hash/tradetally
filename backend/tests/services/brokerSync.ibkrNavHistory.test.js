jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../src/services/brokerSync/ibkrCashLedger',()=>({loadLedger:jest.fn()}));
const {prepare,weekendPoints,saveNavReports}=require('../../src/services/brokerSync/ibkrNavHistory');
const db=require('../../src/config/database');
const {loadLedger}=require('../../src/services/brokerSync/ibkrCashLedger');
const account={id:'a',user_id:'u',account_identifier:'****1234',currency:'USD',initial_balance_date:'2025-01-01'};
const row={accountId:'U1234',currency:'USD',fromDate:'20260112',toDate:'20260119',reportDate:'20260116',cash:'110',options:'-10',total:'100'};
test('retains signed option liabilities and reconciles NAV including accruals',()=>{
 expect(prepare({nav_records:[row]},account)).toEqual([{date:'2026-01-16',cash:110,total:100,holdings:-10}]);
 expect(prepare({nav_records:[{...row,interestAccruals:'2',total:'102'}]},account)[0].holdings).toBe(-8);
});
test('rejects wrong account, currency, date, duplicate conflict and inconsistent totals',()=>{
 for(const patch of [{accountId:'U9999'},{currency:'GBP'},{reportDate:'20260230'},{reportDate:'20260201'},{total:'99'}])expect(()=>prepare({nav_records:[{...row,...patch}]},account)).toThrow();
 expect(()=>prepare({nav_records:[row,{...row,cash:'120',total:'110'}]},account)).toThrow();
 expect(()=>prepare({nav_records:[row],nav_changes:[{toDate:'20260116',endingValue:'99'}]},account)).toThrow();
});
test('weekends preserve marked holdings while applying only the native cash change',()=>{
 const points=[{date:'2026-01-16',cash:110,holdings:-10},{date:'2026-01-19',cash:120,holdings:-8}];
 const ledger={rows:[{date:'2026-01-16',balance:100},{date:'2026-01-17',balance:105},{date:'2026-01-18',balance:105}]};
 expect(weekendPoints(points,ledger)).toEqual([{date:'2026-01-17',cash:115,holdings:-10},{date:'2026-01-18',cash:115,holdings:-10}]);
 expect(weekendPoints(points,{rows:[ledger.rows[0]],openingBalance:100})).toEqual([{date:'2026-01-17',cash:110,holdings:-10},{date:'2026-01-18',cash:110,holdings:-10}]);
 expect(weekendPoints(points,null)).toEqual([]);
 expect(weekendPoints([{...points[0],date:'2026-01-12'},points[1]],ledger)).toEqual([]);
});
test('saves reported NAV separately from weekend estimates and is repeatable by date',async()=>{
 db.query.mockResolvedValue({rows:[account]});loadLedger.mockResolvedValue(null);
 const client={query:jest.fn().mockResolvedValue({rows:[{rates:{GBP:.8}}]})};db.withTransaction.mockImplementation(fn=>fn(client));
 expect(await saveNavReports({userId:'u'},{nav_records:[row]})).toEqual({saved:1,weekends:0});
 expect(client.query.mock.calls[1][0]).toContain('ON CONFLICT');
 expect(client.query.mock.calls[1][1]).toEqual(['u','****1234','2026-01-16',-10,110,.8]);
});
