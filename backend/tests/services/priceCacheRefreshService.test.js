jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/utils/jobQueue',()=>({notifyJobEnqueued:jest.fn()}));
jest.mock('../../src/services/brokerHistoryProviders',()=>({fetch:jest.fn()}));
jest.mock('../../src/services/portfolioService',()=>({_getDailySeries:jest.fn()}));
jest.mock('../../src/services/exchangeCalendar',()=>({resolve:jest.fn().mockResolvedValue('US'),isTradingDay:()=>true}));
jest.mock('../../src/utils/historicalPriceCache',()=>({insertCandles:jest.fn()}));
const db=require('../../src/config/database'),service=require('../../src/services/priceCacheRefreshService');
beforeEach(()=>jest.clearAllMocks());
test('plans all stored quote/history/reconstruction identities and separates coin collisions',async()=>{
 db.query.mockResolvedValueOnce({rows:[{symbol:'SUI',data_source:'yahoo',first:'2025-01-01',last:'2025-02-01'},
  {symbol:'SUI',data_source:'coingecko',first:'2024-01-01',last:'2024-02-01'}]})
 .mockResolvedValueOnce({rows:[{symbol:'crypto:SUI',data_source:'broker:okx:crypto'}]})
 .mockResolvedValueOnce({rows:[{symbol:'BTC-USD',first:'2022-01-01',last:'2022-02-01'}]});
 const tasks=await service.plan();expect(tasks.map(t=>t.key).sort()).toEqual(['SUI','crypto:BTC','crypto:SUI']);
 expect(tasks.find(t=>t.key==='crypto:SUI')).toMatchObject({quote:true,from:'2024-01-01'});
});
test('only explicit broker refresh may replace finalized rows, then fills gaps through the shared pipeline',async()=>{
 db.query.mockResolvedValue({rows:[]});const time=Date.parse('2026-01-01')/1000;
 require('../../src/services/brokerHistoryProviders').fetch.mockImplementation(async({onPrices})=>onPrices([{time,close:10,currency:'USD'}],'example'));
 require('../../src/services/portfolioService')._getDailySeries.mockResolvedValue([{time,close:10}]);
 await service.refreshHistory('owner',{key:'MSFT',symbol:'MSFT',instrumentType:'stock',from:'2026-01-01',to:'2026-01-01'});
 expect(require('../../src/utils/historicalPriceCache').insertCandles).toHaveBeenCalledWith('MSFT',[expect.objectContaining({close:10,currency:'USD'})],'broker:example',{currency:'USD',replaceFinal:true});
 expect(require('../../src/services/portfolioService')._getDailySeries).toHaveBeenCalled();
});
