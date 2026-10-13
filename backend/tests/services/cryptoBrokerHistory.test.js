jest.mock('../../src/services/brokerMarketData',()=>({read:jest.fn(),directory:jest.fn()}));
jest.mock('../../src/services/brokerSync/krakenArchivePrices',()=>({dailyPrices:jest.fn()}));
const market=require('../../src/services/brokerMarketData'),archive=require('../../src/services/brokerSync/krakenArchivePrices'),provider=require('../../src/services/brokerHistoryProviders');
const day=d=>Date.parse(d)/1000;
beforeEach(()=>{jest.clearAllMocks();market.directory.mockImplementation((key,fetch)=>fetch());});
test('Kraken combines older archive with live USD and scales SHIB lot only once',async()=>{
 market.read.mockResolvedValueOnce({result:{SHIBUSD:{wsname:'SHIB/USD'}}}).mockResolvedValueOnce({result:{SHIBUSD:[[day('2021-01-02'),.00002,.00003,.00001,.00002,.00002,2000000,4],[day('2021-01-03'),.00003,.00004,.00002,.00003,.00003,1000000,4]]}});
 archive.dailyPrices.mockResolvedValue({candles:[{time:day('2021-01-01'),open:.00001,high:.00002,low:.000005,close:.00001,volume:1000000},{time:day('2021-01-02'),open:.00001,high:.00002,low:.000005,close:.00001,volume:1000000}]});
 const rows=await provider.kraken({symbol:'SHIBXM',instrumentType:'crypto',from:'2021-01-01',to:'2021-01-02'});
 expect(rows.map(c=>c.close)).toEqual([10,20]);expect(rows.map(c=>c.volume)).toEqual([1,2]);expect(archive.dailyPrices).toHaveBeenCalledWith('SHIBUSD');
});
test('an invalid archive leaves valid live prices intact',async()=>{
 market.read.mockResolvedValueOnce({result:{PAIR:{wsname:'COIN/USD'}}}).mockResolvedValueOnce({result:{PAIR:[[day('2021-01-02'),1,2,.5,1,1,1,2],[day('2021-01-03'),1,2,.5,1,1,1,2]]}});archive.dailyPrices.mockRejectedValue(Error('Invalid archive'));
 const rows=await provider.kraken({symbol:'COIN',instrumentType:'crypto',from:'2021-01-01',to:'2021-01-02'});expect(rows.map(c=>c.time)).toEqual([day('2021-01-02')]);
});
test('stock collision and ambiguous underlying do not request archive prices',async()=>{
 expect(await provider.kraken({symbol:'SHIBXM',instrumentType:'stock',from:'2021-01-01',to:'2021-01-02'})).toEqual([]);expect(market.read).not.toHaveBeenCalled();
 market.read.mockResolvedValue({result:{ONE:{wsname:'SHIB/USD'},TWO:{wsname:'SHIB/USD'}}});expect(await provider.kraken({symbol:'SHIBXM',instrumentType:'crypto',from:'2021-01-01',to:'2021-01-02'})).toEqual([]);expect(archive.dailyPrices).not.toHaveBeenCalled();
});
test('OKX converts dated USDT before applying lot price and inverse volume scale',async()=>{
 const row=[String(day('2021-01-01')*1000),'.00001','.00003','.000005','.00002','2000000','0','0','1'];
 market.read.mockResolvedValueOnce({code:'0',data:[{baseCcy:'SHIB',quoteCcy:'USDT',instId:'SHIB-USDT'}]}).mockResolvedValueOnce({code:'0',data:[row]}).mockResolvedValueOnce({code:'0',data:[[String(day('2021-01-01')*1000),'1.02','1.02','1.02','1.02','1','0','0','1']]});
 const rows=await provider.okx({symbol:'SHIBXM',instrumentType:'crypto',from:'2021-01-01',to:'2021-01-01',connection:{}});expect(rows[0].close).toBeCloseTo(20.4);expect(rows[0].volume).toBe(2);expect(market.read.mock.calls[1][2].instId).toBe('SHIB-USDT');
});
jest.mock('../../src/services/coinGeckoClient',()=>({get:jest.fn()}));
jest.mock('../../src/services/coinGeckoIdentityService',()=>({resolve:jest.fn()}));
test('CoinGecko fallback resolves the underlying token but retains broker lot units',async()=>{
 const cg=require('../../src/services/coinGeckoClient'),identity=require('../../src/services/coinGeckoIdentityService');
 identity.resolve.mockResolvedValue({id:'shiba-inu'});
 const date=new Date(Date.now()-86400000).toISOString().slice(0,10);
 cg.get.mockResolvedValue({data:{prices:[[Date.parse(date),.00002]]}});
 const rows=await require('../../src/services/holdingsHistoryProvider').crypto('SHIBXM',date,date);
 expect(identity.resolve).toHaveBeenCalledWith('SHIB');expect(cg.get.mock.calls[0][0]).toBe('/coins/shiba-inu/market_chart/range');expect(rows[0].close).toBe(20);
});
test('broker-native SHIBXM candles already use lot units and are not rescaled',()=>{
 const rows=provider.etoroDaily({time:'2021-01-01T00:00:00Z',open:10,high:30,low:5,close:20,volume:2},'crypto','USD',null);
 expect(rows.close).toBe(20);expect(rows.volume).toBe(2);
});
test('pre-launch archive recovers predecessor without spilling into successor days',async()=>{
 market.read.mockResolvedValueOnce({result:{SUSD:{wsname:'S/USD'}}}).mockResolvedValueOnce({result:{SUSD:[]}});
 archive.dailyPrices.mockImplementation(async pair=>({candles:(pair==='FTMUSD'?['2024-12-17','2024-12-18']:['2024-12-17','2024-12-18']).map(d=>({time:day(d),open:1,high:1,low:1,close:pair==='FTMUSD'?1:2,volume:1}))}));
 const rows=await provider.kraken({symbol:'S',instrumentType:'crypto',from:'2024-12-17',to:'2024-12-18'});
 expect(rows.map(c=>c.close)).toEqual([1,2]);expect(archive.dailyPrices.mock.calls.map(x=>x[0])).toEqual(['FTMUSD','SUSD']);
});
