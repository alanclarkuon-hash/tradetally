jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const {validateReport,selectReports,dailyRows,loadLedger}=require('../../src/services/brokerSync/ibkrCashLedger');
const db=require('../../src/config/database');
const row=(code,amount,date='20240102')=>({accountId:'U1234',levelOfDetail:'BaseCurrency',activityCode:code,amount:String(amount),currency:'USD',date,tradeCommission:'0'});
const statement={account_id:'U1234',from_date:'20240101',to_date:'20240131'};
function sections(rows,end) {return {statement_of_funds:rows,cash_report:[{accountId:'U1234',currency:'BASE_SUMMARY',startingCash:'0',endingCash:String(end)}]};}
test('rejects a cash ledger that does not match its own broker closing balance',()=>{
  expect(()=>validateReport(statement,sections([row('DEP',100)],101),{currency:'USD'})).toThrow(/reconcile/);
  expect(()=>validateReport(statement,sections([row('DEP',100)],100),{currency:'GBP'})).toThrow(/currency/);
});
test('uses one base ledger and excludes native copies and opening/closing labels',()=>{
  const s=sections([row('DEP',100),{...row('DEP',80),currency:'GBP',levelOfDetail:'Currency'},row('',0)],100);
  expect(validateReport(statement,s,{currency:'USD'}).records).toHaveLength(1);
});
test('trade cash includes commission once; exchange and translation effects are separate from income',()=>{
  const r=validateReport(statement,sections([row('DEP',100),{...row('BUY',-51),tradeCommission:'-1'},row('SELL',59),
    {...row('FOREX',-2),tradeCommission:'-2'}, {...row('ADJ',0.5),activityDescription:'FX Translations P&L'},row('CINT',1)],107.5),{currency:'USD'});
  const days=dailyRows([r],'2024-01-01','2024-01-31');
  expect(days[0]).toMatchObject({net:107.5,trade_outflow:51,trade_inflow:59,fees:3,income:1,fx_adjustments:-1.5});
});
test('overlapping rolling reports do not double-count transactions or FX translations',()=>{
  const reports=[{from_date:'2024-01-01',to_date:'2024-01-31',id:'month1'},
    {from_date:'2024-02-01',to_date:'2024-02-29',id:'month2'},
    {from_date:'2024-01-20',to_date:'2024-02-05',id:'overlap'}];
  expect(selectReports(reports).map(r=>r.id)).toEqual(['month1','month2']);
});
test('superseding complete report coverage replaces overlapping older intervals',()=>{
  const reports=[{from_date:'2024-01-01',to_date:'2024-01-19',id:'old1'},
    {from_date:'2024-01-21',to_date:'2024-02-28',id:'old2'},
    {from_date:'2024-01-01',to_date:'2024-01-31',id:'new1'},
    {from_date:'2024-02-01',to_date:'2024-02-29',id:'new2'}];
  expect(selectReports(reports).map(r=>r.id)).toEqual(['new1','new2']);
});
test('filtered cashflow retains the balance from previous days and reconciles to the statement',async()=>{
  const account={id:'account',broker:'ibkr',currency:'USD',initial_balance:0,initial_balance_date:'2024-01-01'};
  db.query.mockResolvedValue({rows:[{from_date:'2024-01-01',to_date:'2024-01-31',currency:'USD',starting_cash:0,ending_cash:90,
    records:[{date:'2024-01-02',code:'DEP',amount:100,commission:0},{date:'2024-01-15',code:'OFEE',amount:-10,commission:0}]}]});
  const ledger=await loadLedger('owner',account,'2024-01-10','2024-01-31');
  expect(ledger.openingBalance).toBe(100);expect(ledger.rows).toHaveLength(1);expect(ledger.balance).toBe(90);
  expect(ledger.reconciliation).toMatchObject({reportedBalance:90,difference:0,matched:true});
  expect(db.query.mock.calls.at(-1)[1]).toEqual(['owner','account','2024-01-31']);
});
