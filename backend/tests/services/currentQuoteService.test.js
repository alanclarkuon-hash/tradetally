jest.mock('../../src/services/brokerQuoteProviders',()=>({fetch:jest.fn()}));
jest.mock('../../src/utils/finnhubClient',()=>({getQuote:jest.fn(),getCryptoQuote:jest.fn()}));
jest.mock('../../src/utils/schwabMarketData',()=>({getQuote:jest.fn()}));
jest.mock('../../src/utils/yahooFinance',()=>({getQuote:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({getForexRate:jest.fn()}));
const brokers=require('../../src/services/brokerQuoteProviders');
const finnhub=require('../../src/utils/finnhubClient');
const schwab=require('../../src/utils/schwabMarketData');
const yahoo=require('../../src/utils/yahooFinance');
const fx=require('../../src/utils/currencyConverter');
const router=require('../../src/services/currentQuoteService');
beforeEach(()=>{jest.resetAllMocks();brokers.fetch.mockResolvedValue(null);});
test('broker success prevents provider requests for either asset class',async()=>{
 brokers.fetch.mockResolvedValue({c:2,currency:'USD',source:'broker:etoro',asOf:new Date().toISOString()});
 for(const type of ['stock','crypto'])expect((await router.getQuote('EXAMPLE',type)).source).toBe('broker:etoro');
 expect(finnhub.getQuote).not.toHaveBeenCalled();expect(finnhub.getCryptoQuote).not.toHaveBeenCalled();
});
test('stock fallback order covers errors other than 403 and converts Yahoo pence',async()=>{
 const order=[];finnhub.getQuote.mockImplementation(async()=>{order.push('finnhub');throw Error('timeout');});
 schwab.getQuote.mockImplementation(async()=>{order.push('schwab');return null;});
 yahoo.getQuote.mockImplementation(async()=>{order.push('yahoo');return {c:100,pc:90,currency:'GBp'};});fx.getForexRate.mockResolvedValue(1.25);
 expect(await router.getQuote('EXAMPLE.L','stock')).toMatchObject({c:1.25,pc:1.125,currency:'USD',source:'yahoo'});
 expect(order).toEqual(['finnhub','schwab','yahoo']);
});
test('crypto falls through only to CoinGecko, never an equity source',async()=>{
 finnhub.getCryptoQuote.mockResolvedValue({c:0.5});
 expect(await router.getQuote('NEWCOIN','crypto')).toMatchObject({c:0.5,source:'coingecko'});
 expect(finnhub.getQuote).not.toHaveBeenCalled();expect(schwab.getQuote).not.toHaveBeenCalled();expect(yahoo.getQuote).not.toHaveBeenCalled();
});
test('Schwab succeeds before Yahoo and duplicate requests share one fetch',async()=>{
 finnhub.getQuote.mockResolvedValue(null);schwab.getQuote.mockResolvedValue({c:5,t:Math.floor(Date.now()/1000)});
 await Promise.all([router.getQuote('SAME'),router.getQuote('SAME')]);
 expect(brokers.fetch).toHaveBeenCalledTimes(1);expect(schwab.getQuote).toHaveBeenCalledTimes(1);expect(yahoo.getQuote).not.toHaveBeenCalled();
});
test('unknown foreign quote currency is rejected instead of inventing USD',async()=>{
 finnhub.getQuote.mockResolvedValue({c:500});schwab.getQuote.mockResolvedValue(null);yahoo.getQuote.mockResolvedValue({c:500});
 await expect(router.getQuote('UNKNOWN.L')).rejects.toThrow('unavailable');
});

const dated=(minutes,c=5)=>({c,t:Math.floor(Date.now()/1000)-minutes*60,currency:'USD'});
test('stale broker and stale first fallback continue to a fresher source',async()=>{
 brokers.fetch.mockResolvedValue({...dated(60),source:'broker:etoro'});
 finnhub.getQuote.mockResolvedValue(dated(30));schwab.getQuote.mockResolvedValue(dated(20));yahoo.getQuote.mockResolvedValue(dated(1));
 const q=await router.getQuote('FRESHER');expect(q.source).toBe('yahoo');expect(q.t).toBe(dated(1).t);
});
test('closed/halted quotes retain newest actual source time when no fresh source exists',async()=>{
 const saved={...dated(3000),source:'broker:etoro'};brokers.fetch.mockResolvedValue(saved);
 finnhub.getQuote.mockResolvedValue(dated(4000));schwab.getQuote.mockRejectedValue(Error('unavailable'));yahoo.getQuote.mockResolvedValue(null);
 expect(await router.getQuote('HALTED')).toEqual(saved);
});
test('stale crypto broker uses newer CoinGecko time, and never replaces it with older data',async()=>{
 const saved={...dated(60),source:'broker:okx'};brokers.fetch.mockResolvedValue(saved);finnhub.getCryptoQuote.mockResolvedValue(dated(1));
 expect((await router.getQuote('COIN1','crypto')).source).toBe('coingecko');
 finnhub.getCryptoQuote.mockResolvedValue(dated(90));expect(await router.getQuote('COIN2','crypto')).toEqual(saved);
});
test('unknown source time cannot displace a dated stale broker quote',async()=>{
 const saved={...dated(60),source:'broker:etoro'};brokers.fetch.mockResolvedValue(saved);finnhub.getQuote.mockResolvedValue({c:9,currency:'USD'});
 expect(await router.getQuote('UNDATED')).toEqual(saved);
});
