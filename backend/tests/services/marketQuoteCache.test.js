jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/utils/historicalPriceCache',()=>({upsertToday:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({getForexRate:jest.fn()}));
const db=require('../../src/config/database'),history=require('../../src/utils/historicalPriceCache');
const {save}=require('../../src/services/marketQuoteCache');
beforeEach(()=>{jest.clearAllMocks();db.query.mockResolvedValue({rowCount:1,rows:[]});});
test('all writers use atomic provider timestamps and a crypto identity',async()=>{
  const asOf=new Date().toISOString();await save('SUI','crypto',{c:2,source:'broker:kraken',asOf});
  expect(db.query.mock.calls[0][0]).toContain('price_monitoring.last_updated<EXCLUDED.last_updated');
  expect(db.query.mock.calls[0][1]).toEqual(['crypto:SUI',2,null,null,null,null,null,null,null,'broker:kraken:crypto',asOf]);
  expect(history.upsertToday).toHaveBeenCalledWith('crypto:SUI',expect.objectContaining({asOf}),'broker:kraken:crypto');
});
test('a rejected stale quote does not contaminate the provisional daily cache',async()=>{
  db.query.mockResolvedValue({rowCount:0});expect(await save('MSFT','stock',{c:2,t:100,source:'yahoo'})).toBe(false);
  expect(history.upsertToday).not.toHaveBeenCalled();
});
test('zero daily movement is preserved and missing movement remains unavailable',async()=>{
  await save('MSFT','stock',{c:10,pc:10,d:0,dp:0});expect(db.query.mock.calls[0][1].slice(2,5)).toEqual([10,0,0]);
  await save('MSFT','stock',{c:10});expect(db.query.mock.calls[1][1].slice(2,5)).toEqual([null,null,null]);
});
test('foreign quotes are converted before entering the common USD cache',async()=>{
  require('../../src/utils/currencyConverter').getForexRate.mockResolvedValue(1.25);
  await save('WAGB.L','stock',{c:1000,currency:'GBX',source:'broker:trading212'});
  expect(db.query.mock.calls[0][1][1]).toBe(12.5);
});
