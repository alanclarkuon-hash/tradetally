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
 axios.get.mockResolvedValue({data:{chart:{result:[{timestamp:[Date.parse('2026-08-14T13:30Z')/1000,1],indicators:{quote:[{close:[100,null]}]}}]}}});
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
