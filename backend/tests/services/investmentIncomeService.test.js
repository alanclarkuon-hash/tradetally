jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/models/PlaidConnection',()=>({hasSchema:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({getForexRate:jest.fn()}));
const db=require('../../src/config/database');
const Plaid=require('../../src/models/PlaidConnection');
const fx=require('../../src/utils/currencyConverter');
const service=require('../../src/services/investmentIncomeService');
const event=(type,amount,extra={})=>({account_id:'account',event_type:type,amount,currency:'GBP',event_date:'2025-02-01',account_name:'Example',broker_type:'trading212',...extra});
beforeEach(()=>{jest.clearAllMocks();jest.useFakeTimers().setSystemTime(new Date('2025-07-01T12:00:00Z'));Plaid.hasSchema.mockResolvedValue(false);fx.getForexRate.mockResolvedValue(0.8);});
afterEach(()=>jest.useRealTimers());
test('broker income is available without Plaid and deposits are excluded at the source',async()=>{
  db.query.mockResolvedValue({rows:[event('interest',2),event('dividend',3,{description:'DIVIDEND: TESTl_EQ'})]});
  const r=await service.getIncomeSummary('owner',{startDate:'2025-01-01',endDate:'2025-03-01',currency:'GBP'});
  expect(r.summary).toEqual({totalDividends:3,totalInterest:2,totalFees:0,trailing12mDividends:3});
  expect(r.bySymbol.find(x=>x.symbol==='TEST.L')).toMatchObject({dividends:3,transactionCount:1});
  expect(db.query.mock.calls[0][1]).toEqual(['owner','2025-01-01','2025-03-01']);
  expect(db.query.mock.calls[0][0]).toContain("e.event_type IN ('dividend','interest','account_fee','tax')");
  expect(db.query.mock.calls[0][0]).toContain('a.user_id=e.user_id');
  expect(fx.getForexRate).not.toHaveBeenCalled();
});
test('converts currencies using payment dates and preserves fee/tax refunds',async()=>{
  db.query.mockResolvedValue({rows:[event('interest',10,{currency:'USD'}),event('account_fee',-5),event('account_fee',2),event('tax',-1)]});
  const r=await service.getIncomeSummary('owner',{currency:'GBP'});
  expect(r.summary.totalInterest).toBe(8);
  expect(r.summary.totalFees).toBe(4);
  expect(fx.getForexRate).toHaveBeenCalledWith('USD','GBP','2025-02-01');
  expect(r.byMonth).toEqual([{month:'2025-02',dividends:0,interest:8,fees:4}]);
});
test('Kraken Earn income retains the coin label rather than being described as fiat cash',async()=>{
  db.query.mockResolvedValue({rows:[event('interest',10,{currency:'USD',broker_type:'kraken',description:'Kraken Earn/staking: ADA; net 2 coins'})]});
  const result=await service.getIncomeSummary('owner',{currency:'USD'});
  expect(result.summary.totalInterest).toBe(10);
  expect(result.bySymbol[0].symbol).toBe('ADA (Kraken Earn)');
});
test('Plaid sign conventions remain intact and matching linked broker income is not duplicated',async()=>{
  Plaid.hasSchema.mockResolvedValue(true);
  db.query.mockResolvedValueOnce({rows:[event('interest',2)]}).mockResolvedValueOnce({rows:[
    {linked_account_id:'account',transaction_date:'2025-02-01',iso_currency_code:'GBP',amount:-2,metadata:{investmentSubtype:'interest'}},
    {linked_account_id:'other',transaction_date:'2025-02-01',iso_currency_code:'GBP',amount:-2,metadata:{investmentSubtype:'interest'}},
    {transaction_date:'2025-02-01',iso_currency_code:'GBP',amount:3,metadata:{investmentType:'fee'}},
    {transaction_date:'2025-02-01',iso_currency_code:'GBP',amount:-100,metadata:{investmentType:'transfer',investmentSubtype:'deposit'}}
  ]});
  const r=await service.getIncomeSummary('owner',{currency:'GBP'});
  expect(r.summary.totalInterest).toBe(4);
  expect(r.summary.totalFees).toBe(3);
  expect(r.bySymbol.reduce((s,x)=>s+x.transactionCount,0)).toBe(3);
});
test('trailing dividends exclude old and future payments; monthly and symbol totals agree',async()=>{
  const r=await service.aggregate([
    {date:'2024-01-01',currency:'GBP',category:'dividend',value:5,symbol:'TEST'},
    {date:'2025-02-01',currency:'GBP',category:'dividend',value:10,symbol:'TEST'},
    {date:'2026-01-01',currency:'GBP',category:'dividend',value:20,symbol:'TEST'}
  ],'GBP');
  expect(r.summary.trailing12mDividends).toBe(10);
  expect(r.summary.totalDividends).toBe(35);
  expect(r.bySymbol[0].dividends).toBe(35);
});
test('missing currency rates cannot silently mix currencies',async()=>{
  fx.getForexRate.mockResolvedValue(null);
  await expect(service.aggregate([{date:'2025-02-01',currency:'USD',category:'interest',value:1,symbol:'Cash'}],'GBP')).rejects.toThrow('conversion unavailable');
});
