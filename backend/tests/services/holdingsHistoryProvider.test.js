jest.mock('axios', () => ({get:jest.fn()}));
jest.mock('../../src/services/coinGeckoClient', () => ({get:jest.fn()}));
jest.mock('../../src/services/coinGeckoIdentityService', () => ({resolve:jest.fn()}));
const provider=require('../../src/services/holdingsHistoryProvider');
const axios=require('axios'), client=require('../../src/services/coinGeckoClient'), identity=require('../../src/services/coinGeckoIdentityService');
beforeEach(()=>jest.clearAllMocks());
test('missing ranges exclude existing candles and stock weekends',()=>{
 const candles=[{time:Date.parse('2026-08-14')/1000}];
 expect(provider.missingRanges(candles,'2026-08-14','2026-08-17')).toEqual([{from:'2026-08-17',to:'2026-08-17'}]);
 expect(provider.missingRanges(candles,'2026-08-14','2026-08-17',true)).toEqual([{from:'2026-08-15',to:'2026-08-17'}]);
});
test('Yahoo daily timestamps normalize to midnight, null closes are omitted',async()=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'BRK-B'},timestamp:[Date.parse('2026-08-14T13:30Z')/1000,1],indicators:{quote:[{close:[100,null]}]}}]}}});
 const rows=await provider.yahoo('BRK.B','2026-08-14','2026-08-14');
 expect(axios.get.mock.calls[0][0]).toContain('BRK-B');
 expect(rows).toEqual([expect.objectContaining({time:Date.parse('2026-08-14')/1000,close:100})]);
});
test('CoinGecko resolves coin identity and uses the shared budgeted client',async()=>{
 identity.resolve.mockResolvedValue({id:'sui'});
 const day=new Date().toISOString().slice(0,10), t=Date.parse(day);
 client.get.mockResolvedValue({data:{prices:[[t,2],[t+3600000,3]]}});
 expect(await provider.crypto('SUI',day,day)).toEqual([expect.objectContaining({time:t/1000,close:2})]);
 expect(client.get).toHaveBeenCalledWith('/coins/sui/market_chart/range', expect.objectContaining({params:expect.objectContaining({vs_currency:'usd'})}));
});
test('unknown coin identity fails safely instead of querying an equity ticker',async()=>{
 identity.resolve.mockResolvedValue(null);
 await expect(provider.crypto('UNKNOWN','2026-08-01','2026-08-02')).rejects.toThrow('identity');
 expect(client.get).not.toHaveBeenCalled(); expect(axios.get).not.toHaveBeenCalled();
});


test.each([
 ['BABY','babylon'],['CRV','curve-dao-token'],['HYPE','hyperliquid'],
 ['POL','polygon-ecosystem-token'],['SEI','sei-network'],['TAO','bittensor'],['TIA','celestia']
])('verified %s identity does not depend on ambiguous ticker candidates', (symbol,id)=>{
 const {CRYPTO_TO_COINGECKO}=jest.requireActual('../../src/utils/cryptoAssets');
 expect(CRYPTO_TO_COINGECKO[symbol]).toBe(id);
});

 test('a different returned listing is rejected before storing any candles',async()=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'OTHER'},timestamp:[Date.parse('2023-05-01')/1000],indicators:{quote:[{close:[100]}]}}]}}});
 await expect(provider.yahoo('EXAMPLE','2023-05-01','2023-05-01')).rejects.toThrow('listing identity');
 });
 test('a reused listing cannot supply pre-listing or out-of-range candles',async()=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'EXAMPLE',firstTradeDate:Date.parse('2025-05-01')/1000},timestamp:['2023-05-01','2025-05-01','2025-06-01'].map(d=>Date.parse(d)/1000),indicators:{quote:[{close:[10,20,30]}]}}]}}});
 expect(await provider.yahoo('EXAMPLE','2023-05-01','2025-05-01')).toEqual([expect.objectContaining({close:20})]);
 });


test.each([['00257.HK','0257.HK'],['01093.HK','1093.HK'],['00001.hk','0001.HK']])('numeric HK broker code %s uses equivalent provider listing %s',async(symbol,ticker)=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:ticker,currency:'HKD',exchangeName:'HKG'},timestamp:[Date.parse('2022-03-01')/1000],indicators:{quote:[{close:[10]}]}}]}}});
 expect(await provider.yahoo(symbol,'2022-03-01','2022-03-01')).toEqual([expect.objectContaining({close:10,currency:'HKD'})]);
 expect(axios.get.mock.calls[0][0]).toContain('/'+ticker);
});
test.each(['12345.HK','0257.HK','00257.US','00001.L','HK005'])('unrelated or genuine five-digit listing %s is not shortened',async(symbol)=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol,currency:'HKD'},timestamp:[],indicators:{quote:[{close:[]}]}}]}}});
 await provider.yahoo(symbol,'2022-03-01','2022-03-01');
 expect(axios.get.mock.calls[0][0]).toContain('/'+symbol);
});
test.each([
 {symbol:'OTHER.HK',currency:'HKD',exchangeName:'HKG'},
 {symbol:'0257.HK',currency:'USD',exchangeName:'HKG'},
 {symbol:'0257.HK',currency:'HKD',exchangeName:'NYSE'},
 {symbol:'0257.HK',currency:'HKD'},
])('formatted HK listing requires matching symbol, currency and venue %#',async(meta)=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta,timestamp:[Date.parse('2022-03-01')/1000],indicators:{quote:[{close:[10]}]}}]}}});
 await expect(provider.yahoo('00257.HK','2022-03-01','2022-03-01')).rejects.toThrow(/listing/i);
});
test('formatted HK listing retains date/lifetime bounds',async()=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'0257.HK',currency:'HKD',exchangeName:'HKG',firstTradeDate:Date.parse('2022-03-02')/1000},timestamp:['2022-03-01','2022-03-02','2022-03-03'].map(d=>Date.parse(d)/1000),indicators:{quote:[{close:[10,11,12]}]}}]}}});
 expect(await provider.yahoo('00257.HK','2022-03-01','2022-03-02')).toEqual([expect.objectContaining({close:11})]);
});


test.each([
 ['EXAMPLE.US','EXAMPLE','USD','NYQ'],['EXAMPLE.NV','EXAMPLE.AS','EUR','AMS'],
 ['EXAMPLE.ZU','EXAMPLE.SW','CHF','EBS'],['EXAMPLE.ASX','EXAMPLE.AX','AUD','ASX'],
 ['EXAMPLE.B.US','EXAMPLE-B','USD','NMS']
])('broker namespace %s requests verified provider listing %s',async(symbol,ticker,currency,exchangeName)=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:ticker,currency,exchangeName,...(exchangeName==='ASX'?{exchangeTimezoneName:'Australia/Sydney'}:{})},timestamp:[Date.parse('2022-03-01')/1000],indicators:{quote:[{close:[10]}]}}]}}});
 expect(await provider.yahoo(symbol,'2022-03-01','2022-03-01')).toEqual([expect.objectContaining({close:10,currency})]);
 expect(axios.get.mock.calls[0][0]).toContain('/'+ticker);
});
test.each([
 ['EXAMPLE.US',{symbol:'EXAMPLE',currency:'USD',exchangeName:'AMS'}],
 ['EXAMPLE.NV',{symbol:'EXAMPLE.AS',currency:'USD',exchangeName:'AMS'}],
 ['EXAMPLE.ZU',{symbol:'EXAMPLE.SW',currency:'CHF',exchangeName:'GER'}],
 ['EXAMPLE.ASX',{symbol:'OTHER.AX',currency:'AUD',exchangeName:'ASX'}]
])('mapped namespace %s rejects wrong currency, venue or symbol',async(symbol,meta)=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta,timestamp:[],indicators:{quote:[{}]}}]}}});
 await expect(provider.yahoo(symbol,'2022-03-01','2022-03-01')).rejects.toThrow(/listing/);
});
test.each(['EXAMPLE.DE','EXAMPLE.L','EXAMPLE.AS','EXAMPLE.SW','EXAMPLE.AX','EXAMPLE.CO','EXAMPLE.UNKNOWN'])('normal/unknown provider suffix %s stays unchanged',symbol=>expect(provider.yahooTicker(symbol)).toBe(symbol));


test.each([['2023-01-02T23:00:00Z','2023-01-03'],['2023-07-03T00:00:00Z','2023-07-03']])('Australian daily session %s keeps local trading date %s across DST',async(stamp,day)=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'EXAMPLE.AX',currency:'AUD',exchangeName:'ASX',exchangeTimezoneName:'Australia/Sydney',firstTradeDate:Date.parse(stamp)/1000},timestamp:[Date.parse(stamp)/1000],indicators:{quote:[{close:[10]}]}}]}}});
 const rows=await provider.yahoo('EXAMPLE.ASX',day,day);
 expect(rows).toEqual([expect.objectContaining({time:Date.parse(day)/1000})]);
 expect(axios.get.mock.calls[0][1].params.period1).toBeLessThan(Date.parse(day)/1000);
});
test.each([['America/New_York','2023-01-03T14:30:00Z','2023-01-03'],['Asia/Hong_Kong','2023-01-03T01:30:00Z','2023-01-03'],['Pacific/Auckland','2023-01-02T21:00:00Z','2023-01-03']])('declared exchange timezone %s sets the session date', (exchangeTimezoneName,stamp,day)=>expect(provider.yahooSessionDate(Date.parse(stamp)/1000,{exchangeTimezoneName})).toBe(day));
test('Australian sessions without timezone or with invalid timezone are rejected',async()=>{
 for(const exchangeTimezoneName of [undefined,'Invalid/Timezone']){
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'EXAMPLE.AX',currency:'AUD',exchangeName:'ASX',exchangeTimezoneName},timestamp:[Date.parse('2023-01-02T23:00:00Z')/1000],indicators:{quote:[{close:[10]}]}}]}}});
 await expect(provider.yahoo('EXAMPLE.ASX','2023-01-03','2023-01-03')).rejects.toThrow();
 }
});
test('date-window bounds apply after exchange-session normalization',async()=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'EXAMPLE.AX',currency:'AUD',exchangeName:'ASX',exchangeTimezoneName:'Australia/Sydney'},timestamp:['2023-01-01T23:00:00Z','2023-01-02T23:00:00Z','2023-01-03T23:00:00Z'].map(d=>Date.parse(d)/1000),indicators:{quote:[{close:[9,10,11]}]}}]}}});
 expect(await provider.yahoo('EXAMPLE.ASX','2023-01-03','2023-01-03')).toEqual([expect.objectContaining({close:10,time:Date.parse('2023-01-03')/1000})]);
});

test.each(require('../../src/services/calendars/verified-yahoo-aliases.json').listings)('documented broker share class $symbol uses guarded listing $ticker',async listing=>{
 const meta={symbol:listing.ticker,currency:listing.currency,exchangeName:listing.venue,exchangeTimezoneName:listing.venue==='STO'?'Europe/Stockholm':'Europe/Copenhagen'};
 axios.get.mockResolvedValue({data:{chart:{result:[{meta,timestamp:[Date.parse('2023-03-01T08:00Z')/1000],indicators:{quote:[{close:[10]}]}}]}}});
 expect(await provider.yahoo(listing.symbol.toLowerCase(),'2023-03-01','2023-03-01')).toEqual([expect.objectContaining({close:10,currency:listing.currency})]);
 expect(axios.get.mock.calls[0][0]).toContain('/'+listing.ticker);
});
test.each(['ABB.ST','SOBI.ST','UNKNOWNB.ST','HUSQ-B.ST','OTHERB.CO'])('unregistered Nordic symbol %s is never guessed',symbol=>expect(provider.yahooTicker(symbol)).toBe(symbol));
test.each([{symbol:'HUSQ-A.ST',currency:'SEK',exchangeName:'STO'},{symbol:'HUSQ-B.ST',currency:'DKK',exchangeName:'STO'},{symbol:'HUSQ-B.ST',currency:'SEK',exchangeName:'CPH'},{symbol:'HUSQ-B.ST',currency:'SEK'}])('Nordic alias rejects wrong class, currency or venue %#',meta=>expect(()=>provider.verifyYahooListing('HUSQB.ST',meta)).toThrow(/listing/i));

test.each(require('../../src/services/calendars/verified-yahoo-aliases.json').listings)('source-backed listing $symbol rejects mismatched native metadata',listing=>{
 const meta={symbol:listing.ticker,currency:listing.currency,exchangeName:listing.venue};
 expect(()=>provider.verifyYahooListing(listing.symbol,{...meta,currency:listing.currency==='USD'?'EUR':'USD'})).toThrow(/listing/i);
 expect(()=>provider.verifyYahooListing(listing.symbol,{...meta,exchangeName:'WRONG'})).toThrow(/listing/i);
 expect(()=>provider.verifyYahooListing(listing.symbol,{...meta,symbol:'WRONG'})).toThrow(/listing/i);
});
test.each(['HDD.F','GYC.F','HLAG.F','SZG.F','EVK.F'])('verified Frankfurt %s cannot become Xetra or USD',symbol=>{
 expect(()=>provider.verifyYahooListing(symbol,{symbol,currency:'EUR',exchangeName:'FRA'})).not.toThrow();
 expect(()=>provider.verifyYahooListing(symbol,{symbol,currency:'EUR',exchangeName:'GER'})).toThrow(/venue/);
 expect(()=>provider.verifyYahooListing(symbol,{symbol,currency:'USD',exchangeName:'FRA'})).toThrow(/currency/);
});
