jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({getForexRate:jest.fn()}));
const db=require('../../src/config/database');
const {walletRows,saveCashReport,loadLedger}=require('../../src/services/brokerSync/trading212CashLedger');
const item=(id,side,value,date='2024-01-02')=>({fill:{id,type:'TRADE',filledAt:`${date}T12:00:00Z`,quantity:2,price:20,
  walletImpact:{currency:'GBP',netValue:value,taxes:[{currency:'GBP',quantity:-0.1}]}},order:{side,instrument:{ticker:'TEST_EQ'}}});
beforeEach(()=>jest.clearAllMocks());
test('uses native net wallet amounts once and excludes split cash-neutral pairs',()=>{
  const split={...item('s','BUY',100),fill:{...item('s','BUY',100).fill,type:'STOCK_SPLIT'}};
  expect(walletRows([item('b','BUY',10),item('s','SELL',12),split],'GBP')).toEqual([
    expect.objectContaining({amount:-10,fees:0.1}),expect.objectContaining({amount:12,fees:0.1})]);
});
test('rejects unsupported currencies, missing wallet amounts and conflicting identities',()=>{
  expect(()=>walletRows([item('b','BUY',10)],'USD')).toThrow('Incomplete');
  expect(()=>walletRows([item('b','BUY',10),item('b','BUY',11)],'GBP')).toThrow('Conflicting');
  expect(()=>walletRows([item('b','BUY',undefined)],'GBP')).toThrow('Incomplete');
});
test('wallet snapshots cannot silently shorten history or switch accounts',async()=>{
  await expect(saveCashReport({externalAccountId:'1234'},[],{id:'4321'})).rejects.toThrow('account mismatch');
  db.query.mockResolvedValueOnce({rows:[{id:'account',currency:'GBP',initial_balance:0,initial_balance_date:'2024-01-01'}]})
    .mockResolvedValueOnce({rows:[{records:[{reference:'old'}]}]});
  await expect(saveCashReport({userId:'owner',externalAccountId:'1234'},[item('new','BUY',10)],
    {id:1234,currency:'GBP',cash:{availableToTrade:10,reservedForOrders:2,inPies:1}})).rejects.toThrow('does not cover');
  expect(db.query).toHaveBeenCalledTimes(2);
});
test('native cash reconciles without double-subtracting fees and date filters carry the opening cash',async()=>{
  const report={currency:'GBP',to_date:'2024-01-03',ending_cash:102,records:walletRows([item('b','BUY',10),item('s','SELL',12,'2024-01-03')],'GBP')};
  db.query.mockResolvedValueOnce({rows:[report]}).mockResolvedValueOnce({rows:[{event_date:'2024-01-01',event_type:'deposit',amount:100,currency:'GBP'}]})
    .mockResolvedValueOnce({rows:[]});
  const ledger=await loadLedger('owner',{id:'account',broker:'trading212',currency:'GBP',initial_balance:0,initial_balance_date:'2024-01-01'},'2024-01-03','2024-01-03');
  expect(ledger.openingBalance).toBe(90);
  expect(ledger.balance).toBe(102);
  expect(ledger.rows).toHaveLength(1);
  expect(ledger.rows[0]).toMatchObject({net:12,fees:0.1});
  expect(ledger.reconciliation).toMatchObject({matched:true,difference:0});
  expect(db.query.mock.calls[0][1]).toEqual(['owner','account']);
});
test('mismatched broker cash remains visible rather than adding a balancing entry',async()=>{
  db.query.mockResolvedValueOnce({rows:[{currency:'GBP',to_date:'2024-01-03',ending_cash:50,records:[]}]})
    .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});
  const ledger=await loadLedger('owner',{id:'account',broker:'trading212',currency:'GBP',initial_balance:0,initial_balance_date:'2024-01-01'},'2024-01-01','2024-01-03');
  expect(ledger.reconciliation).toMatchObject({matched:false,difference:-50});
  expect(ledger.rows).toHaveLength(0);
});
