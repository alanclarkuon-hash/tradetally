jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({convertToUSD:jest.fn(),getForexRate:jest.fn()}));
const db=require('../../src/config/database');
const fx=require('../../src/utils/currencyConverter');
const {cashEvent,importCashEvents}=require('../../src/services/brokerSync/ibkrCashEvents');
const {enrichCashflow}=require('../../src/services/brokerSync/cashflowEvents');
const {decodeIBKRFlexReport}=require('../../src/utils/ibkrFlexReport');
const row=(code,amount,id='1')=>({accountId:'U1234',activityCode:code,amount:String(amount),currency:'USD',date:'20260112',transactionID:id,activityDescription:'Example'});
beforeEach(()=>{jest.clearAllMocks();fx.convertToUSD.mockImplementation(async amount=>({amountUSD:amount,exchangeRate:1}));fx.getForexRate.mockResolvedValue(0.8);});
test('decodes the cash ledger independently of trades and inherits statement account identity',()=>{
  const decoded=decodeIBKRFlexReport('<FlexQueryResponse><FlexStatement accountId="U1234"><StatementOfFunds><StatementOfFundsLine activityCode="OFEE" amount="-5" currency="USD" date="20260112" transactionID="1" /></StatementOfFunds><CashReport><CashReportCurrency otherFees="-5" /></CashReport></FlexStatement></FlexQueryResponse>');
  expect(decoded.cash_sections.statement_of_funds).toHaveLength(1);
  expect(cashEvent(decoded.cash_sections.statement_of_funds[0],true)).toMatchObject({type:'account_fee',amount:-5,account:'U1234'});
});
test('CSV cash sections cannot be misclassified as trades',()=>{
  const decoded=decodeIBKRFlexReport('Statement of Funds,Header,Account ID,Activity Code,Amount,Currency,Date,Transaction ID\nStatement of Funds,Data,U1234,OFEE,-5,USD,20260112,1');
  expect(decoded.trade_records).toHaveLength(0);
  expect(cashEvent(decoded.cash_sections.statement_of_funds[0],true).amount).toBe(-5);
});
test('maps income, funding, fees and taxes, but excludes trading and accruals',()=>{
  for(const [code,type] of Object.entries({DEP:'deposit',WITH:'withdrawal',DIV:'dividend',CINT:'interest',DINT:'interest',OFEE:'account_fee',FRTAX:'tax'})) expect(cashEvent(row(code,-5),true).type).toBe(type);
  expect(cashEvent(row('BUY',-5),true)).toBeNull();
  expect(cashEvent(row('FOREX',-5),true)).toBeNull();
  expect(cashEvent({...row('OFEE',-5),amount:'',debit:'5'},true).amount).toBe(-5);
  expect(()=>cashEvent({...row('DEP',5),transactionID:''},true)).toThrow(/transaction ID/);
});
test('owner-scoped upserts preserve repeat syncs, ignoring cash summaries and the duplicate section',async()=>{
  db.query.mockResolvedValue({rows:[{id:'account',broker:'ibkr',account_identifier:'****1234'}]});
  const client={query:jest.fn().mockResolvedValue({rows:[{inserted:true}]})};
  db.withTransaction.mockImplementation(fn=>fn(client));
  const sections={statement_of_funds:[row('DEP',100),row('OFEE',-5,'2'),row('OFEE',-5,'2')],cash_transactions:[{...row('DEP',100),type:'DEPOSITS/WITHDRAWALS'}],cash_report:[{otherFees:-5}]};
  expect(await importCashEvents({userId:'owner'},sections)).toMatchObject({imported:2,rows:2});
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(client.query.mock.calls[0][1].slice(0,2)).toEqual(['owner','account']);
  client.query.mockResolvedValue({rows:[{inserted:false}]});
  expect(await importCashEvents({userId:'owner'},sections)).toMatchObject({imported:0,matched:2});
});
test('invalid or conflicting rows abort cash writes rather than partially importing',async()=>{
  const result=await importCashEvents({userId:'owner'},{statement_of_funds:[row('DEP',100),row('DEP',101)]});
  expect(result.imported).toBe(0);expect(result.warnings).toHaveLength(1);expect(db.withTransaction).not.toHaveBeenCalled();
});
test('cashflow includes signed fees and refunds without double-counting trading commission',async()=>{
  db.query.mockResolvedValue({rows:[{event_date:'2026-01-12',event_type:'account_fee',amount:-5,currency:'USD'},{event_date:'2026-01-12',event_type:'account_fee',amount:2,currency:'USD'},{event_date:'2026-01-13',event_type:'dividend',amount:10,currency:'USD'}]});
  const result=await enrichCashflow('owner','account',[{date:'2026-01-12',trade_inflow:100,trade_outflow:51,fees:1,inflow:100,outflow:51}], '2026-01-01','2026-01-31','USD');
  expect(result[0]).toMatchObject({inflow:102,outflow:56,net:46,fees:4,account_fees:3});
  expect(result[1]).toMatchObject({inflow:10,income:10,net:10});
});
test('GBP accounts convert USD trades while GBP cash events retain their actual amounts',async()=>{
  db.query.mockResolvedValue({rows:[{event_date:'2026-01-12',event_type:'deposit',amount:100,currency:'GBP'}]});
  const rows=await enrichCashflow('owner','account',[{date:'2026-01-12',trade_inflow:0,trade_outflow:50,fees:1,inflow:0,outflow:50}], '2026-01-01','2026-01-31','GBP');
  expect(rows[0]).toMatchObject({deposits:100,outflow:40,inflow:100,net:60});
});
