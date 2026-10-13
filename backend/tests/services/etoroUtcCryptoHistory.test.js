jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn()}));
jest.mock('../../src/services/brokerMarketData',()=>({directory:(_key,load)=>load(),read:jest.fn()}));
jest.mock('../../src/services/brokerSync/etoroService',()=>({get:jest.fn(),field:(o,k)=>o?.[k]}));
const {etoroCryptoDays,etoroCandles}=require('../../src/services/brokerHistoryProviders');
const db=require('../../src/config/database');
const etoro=require('../../src/services/brokerSync/etoroService');
const date='2023-10-25',start=Date.parse(date);
const bars=(when=start)=>Array.from({length:24},(_,hour)=>({time:new Date(when+hour*3600000).toISOString(),open:String(10+hour),high:String(12+hour),low:String(9+hour),close:String(11+hour),volume:'2'}));
const types=[{instrumentTypeId:10,instrumentTypeDescription:'Crypto'}];
const page=(rows,extra={})=>({instrumentId:77,symbol:'COIN/USD',interval:'1h',side:'bid',results:rows,pagination:{hasNext:false},...extra});
const request=(extra={})=>etoroCandles({symbol:'COIN',instrumentType:'crypto',from:date,to:date,userId:'synthetic',connection:{id:'synthetic'},...extra});
function snapshot(symbol='COIN') {db.query.mockResolvedValue({rows:[{payload:{instruments:[{instrumentId:77,symbolFull:symbol,instrumentTypeId:10}],instrumentTypes:types}}]});}
function coverage(){etoro.get.mockResolvedValueOnce({instrumentId:77,intervals:[{interval:'1h',candles:24},{interval:'1d',candles:1}]});}
beforeEach(()=>{jest.resetAllMocks();snapshot();});
afterEach(()=>jest.useRealTimers());
test('complete descending UTC hours aggregate OHLCV at midnight',()=>{
 expect(etoroCryptoDays(bars().reverse())).toEqual([{time:start/1000,open:10,high:35,low:9,close:34,volume:48,currency:'USD'}]);
});
test.each(['missing','invalid','conflict','misaligned'])('%s hourly evidence cannot certify a complete day',mode=>{
 const rows=bars();
 if(mode==='missing')rows.splice(10,1);
 if(mode==='invalid')rows[10].high='1';
 if(mode==='conflict')rows.push({...rows[10],close:'22'});
 if(mode==='misaligned')rows.push({...rows[10],time:new Date(start+1000).toISOString()});
 expect(etoroCryptoDays(rows)).toEqual([]);
});
test('identical duplicate hours deduplicate and adjacent days stay independent',()=>{
 const rows=bars();
 expect(etoroCryptoDays([...rows,...bars(start+86400000).slice(0,23),rows[3]]).map(c=>c.time)).toEqual([start/1000]);
});
test('hourly native history is preferred over non-UTC daily bars',async()=>{
 coverage();etoro.get.mockResolvedValueOnce(page(bars()));
 expect(await request()).toHaveLength(1);
 expect(etoro.get.mock.calls[1][2]).toEqual(expect.objectContaining({interval:'1h',side:'bid',format:'verbose'}));
});
test('closed instruments use typed metadata after untyped search',async()=>{
 db.query.mockResolvedValue({rows:[{payload:{instruments:[],instrumentTypes:types}}]});
 etoro.get.mockResolvedValueOnce({items:[{instrumentId:77,internalSymbolFull:'COIN'}]})
 .mockResolvedValueOnce({instrumentDisplayDatas:[{instrumentId:77,symbolFull:'COIN',instrumentTypeId:10}]});
 coverage();etoro.get.mockResolvedValueOnce(page(bars()));
 expect(await request()).toHaveLength(1);
 expect(etoro.get.mock.calls[1]).toEqual([expect.anything(),'/market-data/instruments',{instrumentIds:'77'}]);
});
test.each([{instrumentId:88,symbolFull:'COIN',instrumentTypeId:10},{instrumentId:77,symbolFull:'OTHER',instrumentTypeId:10},{instrumentId:77,symbolFull:'COIN',instrumentTypeId:1}])('wrong typed identity/type cannot fetch history: %p',async metadata=>{
 db.query.mockResolvedValue({rows:[{payload:{instruments:[],instrumentTypes:[...types,{instrumentTypeId:1,instrumentTypeDescription:'Stocks'}]}}]});
 etoro.get.mockResolvedValueOnce({items:[{instrumentId:77,internalSymbolFull:'COIN'}]}).mockResolvedValueOnce({instrumentDisplayDatas:[metadata]});
 expect(await request()).toEqual([]);expect(etoro.get).toHaveBeenCalledTimes(2);
});
test.each([{symbol:'COIN/EUR'},{symbol:'OTHER/USD'},{side:'ask'},{interval:'1d'},{instrumentId:78}])('rejects mismatched native response: %p',async extra=>{
 coverage();etoro.get.mockResolvedValueOnce(page(bars(),extra));
 await expect(request()).rejects.toThrow();
});
test('pagination joins hours before checking daily completeness',async()=>{
 coverage();etoro.get.mockResolvedValueOnce(page(bars().slice(0,12),{pagination:{hasNext:true,nextCursor:'next'}})).mockResolvedValueOnce(page(bars().slice(12)));
 expect(await request()).toHaveLength(1);expect(etoro.get.mock.calls[2][2].cursor).toBe('next');
});
test('repeated cursor rejects partial history',async()=>{
 coverage();etoro.get.mockResolvedValue(page(bars().slice(0,12),{pagination:{hasNext:true,nextCursor:'same'}}));
 await expect(request()).rejects.toThrow('cursor did not advance');
});
test('native broker lot prices are not scaled again',async()=>{
 snapshot('SHIBXM');coverage();etoro.get.mockResolvedValueOnce(page(bars(),{symbol:'SHIBXM/USD'}));
 const result=await request({symbol:'SHIBXM'});expect(result[0].close).toBe(34);expect(result[0].volume).toBe(48);
});
test('current UTC day is never persisted even with 24 supplied bars',async()=>{
 jest.useFakeTimers().setSystemTime(new Date('2023-10-25T12:00:00Z'));
 coverage();etoro.get.mockResolvedValueOnce(page(bars()));expect(await request()).toEqual([]);
});