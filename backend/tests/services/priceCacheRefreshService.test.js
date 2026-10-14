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


test('saved native broker keys never enter stock history or quote refresh',async()=>{
 db.query.mockImplementation(async sql=>({rows:sql.includes('FROM historical_prices')?[{symbol:'IX.D.SYNTH.DAILY',data_source:'yahoo',first:'2026-01-01',last:'2026-01-02'}]:sql.includes('FROM price_monitoring')?[{symbol:'IX.D.SYNTH.DAILY',data_source:'yahoo'}]:sql.includes('FROM trades')?[{symbol:'IX.D.SYNTH.DAILY',instrument_type:'spread_bet'}]:[]}));
 const tasks=await service.plan();expect(tasks[0]).toMatchObject({unsupported:true,instrumentType:'spread_bet'});
 const quote=jest.spyOn(require('../../src/services/currentQuoteService'),'getQuote');
 const maintenance=jest.spyOn(require('../../src/services/brokerPortfolioMaintenance'),'maintain').mockResolvedValue({warnings:[]});
 const invalidation=jest.spyOn(require('../../src/services/analyticsCache'),'invalidate').mockResolvedValue();
 try {const result=await service.process({id:'job',user_id:'owner',result:{tasks,processed:0,complete:0,gaps:[],stage:'broker_refresh',brokerRows:0,quotesRefreshed:0}},async()=>{});
 expect(result.gaps[0].unsupported).toBe(true);expect(result.complete).toBe(0);expect(quote).not.toHaveBeenCalled();expect(require('../../src/services/portfolioService')._getDailySeries).not.toHaveBeenCalled();}
 finally {quote.mockRestore();maintenance.mockRestore();invalidation.mockRestore();}
});

test('refresh planning decodes protocol namespaces and excludes retired Skycoin history',async()=>{db.query.mockImplementation(async sql=>({rows:sql.includes('FROM historical_prices')?[{symbol:'crypto:SKY',data_source:'reconstruction_cache',first:'2022-01-01',last:'2025-01-03'},{symbol:'crypto:SKY:sky',data_source:'broker:kraken',first:'2025-01-01',last:'2025-01-03'}]:sql.includes('FROM portfolio_reconstruction_prices')?[{symbol:'SKY-USD',first:'2022-01-01',last:'2025-01-03'},{symbol:'SKY@sky-USD',first:'2025-01-01',last:'2025-01-03'}]:[]}));const tasks=await require('../../src/services/priceCacheRefreshService').plan();expect(tasks).toHaveLength(1);expect(tasks[0]).toMatchObject({symbol:'SKY',instrumentType:'crypto',from:'2025-01-01'});});
