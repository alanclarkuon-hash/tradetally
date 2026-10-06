jest.mock('../../src/utils/currencyConverter',()=>({getForexRate:jest.fn()}));
jest.mock('../../src/config/database',()=>({query:jest.fn().mockResolvedValue({rows:[]})}));
const fx=require('../../src/utils/currencyConverter'),{toUsd}=require('../../src/utils/dailyPriceCurrency');
test('converts broker/native minor units with dated FX and never invents a currency',async()=>{
 fx.getForexRate.mockResolvedValue(1.25);const time=Date.parse('2026-01-02')/1000;
 const result=await toUsd([{time,close:4000,currency:'GBp'}]);
 expect(result[0]).toMatchObject({close:50,currency:'USD'});
 expect(fx.getForexRate).toHaveBeenCalledWith('GBP','USD','2026-01-02');
 expect(await toUsd([{time,close:4000}])).toEqual([]);
});
