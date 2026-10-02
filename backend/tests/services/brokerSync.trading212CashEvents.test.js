jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({convertToUSD:jest.fn()}));
jest.mock('../../src/utils/logger',()=>({info:jest.fn(),warn:jest.fn(),error:jest.fn(),logError:jest.fn()}));
const db=require('../../src/config/database');
const fx=require('../../src/utils/currencyConverter');
const {cashEvent,importCashEvents}=require('../../src/services/brokerSync/trading212CashEvents');
const service=require('../../src/services/brokerSync/trading212Service');
const row=(type,amount,reference='1')=>({type,amount,reference,currency:'GBP',dateTime:'2024-01-02T12:00:00Z'});
beforeEach(()=>{jest.clearAllMocks();fx.convertToUSD.mockImplementation(async amount=>({amountUSD:amount*1.25,exchangeRate:1.25}));});
test('preserves signed deposits, withdrawals, transfers, fees and interest',()=>{
  for(const [type,amount,expected] of [['DEPOSIT',10,'deposit'],['WITHDRAW',-10,'withdrawal'],['TRANSFER',10,'deposit'],['TRANSFER',-10,'withdrawal'],['FEE',-1,'account_fee'],['INTEREST_ON_FREE_CASH',1,'interest'],['LENDING_INTEREST',1,'interest']]) {
    expect(cashEvent(row(type,amount),'transactions')).toMatchObject({type:expected,amount,currency:'GBP'});
  }
});
test('uses paid net dividend amount once, including property and exempt distributions',()=>{
  const result=cashEvent({...row('PROPERTY_INCOME_DISTRIBUTION',5),paidOn:'2024-01-03T12:00:00Z',grossAmountPerShare:8,amountInEuro:6,ticker:'TEST_EQ'},'dividends');
  expect(result).toMatchObject({type:'dividend',amount:5,date:'2024-01-03',reference:'dividends:1'});
  expect(()=>cashEvent(row('UNKNOWN',1),'transactions')).toThrow('Unsupported');
  expect(()=>cashEvent({...row('DEPOSIT',1),reference:''},'transactions')).toThrow('Invalid');
});
test('requires an owner-scoped unique managed account before any write',async()=>{
  db.query.mockResolvedValue({rows:[]});
  await expect(importCashEvents({userId:'owner',externalAccountId:'1234'},{transactions:[],dividends:[]})).rejects.toThrow('matching managed account');
  expect(db.query.mock.calls[0][1]).toEqual(['owner','1234','****1234']);
  expect(db.withTransaction).not.toHaveBeenCalled();
});
test('deduplicates repeated pages and upserts existing payments without adding them again',async()=>{
  db.query.mockResolvedValue({rows:[{id:'account'}]});
  const client={query:jest.fn().mockResolvedValue({rows:[{inserted:false}]})};
  db.withTransaction.mockImplementation(fn=>fn(client));
  const r=await importCashEvents({userId:'owner',externalAccountId:'1234'},{transactions:[row('DEPOSIT',10),row('DEPOSIT',10)],dividends:[]});
  expect(r).toEqual({imported:0,matched:1,rows:1});
  expect(client.query.mock.calls[0][0]).toContain('ON CONFLICT(user_id,account_id,broker_type,reference_id)');
  expect(client.query.mock.calls[0][1]).toEqual(['owner','account','transactions:1','deposit','2024-01-02',10,'GBP',12.5,'DEPOSIT']);
});
test('conflicting payment identities abort before any transaction',async()=>{
  db.query.mockResolvedValue({rows:[{id:'account'}]});
  await expect(importCashEvents({userId:'owner',externalAccountId:'1234'},{transactions:[row('DEPOSIT',10),row('DEPOSIT',20)],dividends:[]})).rejects.toThrow('Conflicting');
  expect(db.withTransaction).not.toHaveBeenCalled();
});

test('sync rejects changed statement-annotated payments rather than overwriting verified corrections',async()=>{
  db.query.mockResolvedValue({rows:[{id:'account'}]});
  const client={query:jest.fn().mockResolvedValue({rows:[]})};
  db.withTransaction.mockImplementation(fn=>fn(client));
  await expect(importCashEvents({userId:'owner',externalAccountId:'1234'},
    {transactions:[row('DEPOSIT',10)],dividends:[]})).rejects.toThrow('differs from its statement annotation');
  expect(client.query.mock.calls[0][0]).toContain("metadata->'statement_annotation'->>'apiAmount'");
});
test('cash pagination rejects cross-origin credential forwarding and malformed results',async()=>{
  const request=jest.spyOn(service,'requestPage').mockResolvedValue({data:{items:[],nextPagePath:'https://example.com/api/v0/equity/history/transactions'}});
  await expect(service.fetchCashHistory({},'transactions')).rejects.toThrow('pagination URL');
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValue({data:{}});
  await expect(service.fetchCashHistory({},'dividends')).rejects.toThrow('history response');
  request.mockRestore();
});
