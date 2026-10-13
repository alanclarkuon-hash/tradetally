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
test('exact search paginates with page and can find the identity on a later prefix page',async()=>{
 const {etoroSearch}=require('../../src/services/brokerHistoryProviders');
 etoro.get.mockResolvedValueOnce({page:1,totalItems:2,items:[{instrumentId:78,internalSymbolFull:'COIN.FUT'}]}).mockResolvedValueOnce({page:2,totalItems:2,items:[{instrumentId:77,internalSymbolFull:'COIN'}]});
 expect(await etoroSearch({},'COIN')).toEqual([{instrumentId:77,internalSymbolFull:'COIN'}]);
 expect(etoro.get.mock.calls[1][2]).toMatchObject({page:2});expect(etoro.get.mock.calls[1][2]).not.toHaveProperty('pageNumber');
});
test.each(['repeated','wrongPage','empty','unfiltered'])('invalid %s search pagination fails closed',async mode=>{
 const {etoroSearch}=require('../../src/services/brokerHistoryProviders');
 const first={page:1,totalItems:2,items:[{instrumentId:77,internalSymbolFull:'COIN'}]};
 if(mode==='unfiltered')first.totalItems=12117;
 etoro.get.mockResolvedValueOnce(first).mockResolvedValueOnce({page:mode==='wrongPage'?1:2,totalItems:2,items:mode==='empty'?[]:[{instrumentId:77,internalSymbolFull:'COIN'}]});
 await expect(etoroSearch({},'COIN')).rejects.toThrow();
});
test('typed venue directory retains exact retired equities omitted by search',async()=>{
 const {etoroArchivedEquities}=require('../../src/services/brokerHistoryProviders');
 etoro.get.mockResolvedValueOnce({exchangeInfo:[{exchangeId:4,exchangeDescription:'Nasdaq'},{exchangeId:5,exchangeDescription:'NYSE'}]})
 .mockResolvedValueOnce({instrumentDisplayDatas:[{instrumentId:88,instrumentTypeId:5,symbolFull:'RETIRED',exchangeId:4,images:['unused']}]})
 .mockResolvedValueOnce({instrumentDisplayDatas:[{instrumentId:89,instrumentTypeId:6,symbolFull:'OTHER',exchangeId:5}]});
 expect(await etoroArchivedEquities({},'RETIRED')).toEqual([{instrumentId:88,instrumentTypeId:5,symbolFull:'RETIRED',exchangeId:4,exchange:'Nasdaq'}]);
 expect(etoro.get.mock.calls[1][2]).toEqual({instrumentTypeIds:'5,6',exchangeIds:'4'});
});
test.each([{instrumentId:88,instrumentTypeId:1,symbolFull:'COIN',exchangeId:4},{instrumentId:88,instrumentTypeId:5,symbolFull:'COIN',exchangeId:5},{instrumentId:-1,instrumentTypeId:5,symbolFull:'COIN',exchangeId:4}])('archived directory rejects wrong product or venue: %p',async row=>{
 const {etoroArchivedEquities}=require('../../src/services/brokerHistoryProviders');
 etoro.get.mockResolvedValueOnce({exchangeInfo:[{exchangeId:4}]}).mockResolvedValueOnce({instrumentDisplayDatas:[row]});
 await expect(etoroArchivedEquities({},'COIN')).rejects.toThrow();
});
test('duplicate venues cannot certify an archived directory',async()=>{
 const {etoroArchivedEquities}=require('../../src/services/brokerHistoryProviders');
 etoro.get.mockResolvedValueOnce({exchangeInfo:[{exchangeId:4},{exchangeId:4}]});
 await expect(etoroArchivedEquities({},'COIN')).rejects.toThrow();
});
test('native London display format is scoped to the exact typed LSE identity',()=>{
 const {etoroQuoteSymbol}=require('../../src/services/brokerHistoryProviders');
 const metadata={symbolFull:'FXPO.L',exchangeId:7};
 expect(etoroQuoteSymbol('FXPO.L','FXPO',metadata)).toBe(true);
 expect(etoroQuoteSymbol('FXPO.L','FXPO.L',metadata)).toBe(true);
 expect(etoroQuoteSymbol('FXPO.L','FXPO',{...metadata,exchangeId:4})).toBe(false);
 expect(etoroQuoteSymbol('FXPO.L','FXPO',{...metadata,symbolFull:'OTHER.L'})).toBe(false);
 expect(etoroQuoteSymbol('BRK.B','BRK',{symbolFull:'BRK.B',exchangeId:7})).toBe(false);
 expect(etoroQuoteSymbol('FXPO.L','OTHER',metadata)).toBe(false);
});

test('a lagging detailed range uses only verified coverage currency for the alternate feed',async()=>{
 const snapshotPayload={instruments:[{instrumentId:77,symbolFull:'LAG.L',instrumentTypeId:5,exchangeId:7}],instrumentTypes:[{instrumentTypeId:5,instrumentTypeDescription:'Stocks'}]};
 const ref={currency:'GBP',splits:[],prices:['2023-10-20','2023-10-23','2023-10-24'].map(date=>({date,close:1}))};
 db.query.mockImplementation(async sql=>({rows:[{payload:sql.includes('broker_import_snapshots')?snapshotPayload:ref}]}));
 etoro.get.mockResolvedValueOnce({instrumentId:77,symbol:'LAG/GBX',intervals:[{interval:'1d',candles:100}]})
 .mockResolvedValueOnce({instrumentId:77,symbol:null,interval:'1d',side:'bid',results:[],pagination:{hasNext:false}})
 .mockResolvedValueOnce({interval:'OneDay',candles:[{instrumentId:77,candles:['2023-10-20','2023-10-23','2023-10-24','2023-10-25'].map(date=>({instrumentId:77,fromDate:date+'T00:00:00Z',open:100,high:101,low:99,close:100,volume:0}))}]});
 expect(await request({symbol:'LAG.L',instrumentType:'stock'})).toEqual([expect.objectContaining({close:1,currency:'GBP'})]);
 expect(etoro.get.mock.calls.at(-1)[1]).toBe('/market-data/instruments/77/history/candles/desc/OneDay/1000');
});

test.each([['RETIRED','RETIRED',4],['NVTKL.L','NVTKL',7]])('statement recovery scopes the canonical account and exact registered USD listing: %s',async(symbol,raw,exchangeId)=>{
 const days=['2023-05-02','2023-05-03','2023-05-05'];
 const trades=days.map((date,i)=>({symbol:raw,broker:'etoro',account_identifier:'eToro ****1234',entry_time:date+'T12:00:00Z',entry_price:10,quantity:1,executions:[{type:'entry',datetime:date+'T12:00:00Z',price:10,quantity:1,etoro_leverage:1,etoro_statement_source:true,etoro_position_id:String(i+1),etoro_record_key:'statement:'+(i+1),etoro_native_price:10,etoro_fx:1}]}));
 const records=trades.map((t,i)=>({sourceType:'Open Position',details:raw+'/USD',positionId:String(i+1),time:t.entry_time,amount:-10,units:1}));
 db.query.mockImplementation(async sql=>({rows:sql.includes('broker_import_snapshots')?[{payload:{instruments:[{instrumentId:77,symbolFull:symbol,instrumentTypeId:5,exchangeId}],instrumentTypes:[{instrumentTypeId:5,instrumentTypeDescription:'Stocks'}]}}]:sql.startsWith('SELECT * FROM trades')?trades:sql.includes('broker_cash_reports')?[{records}]:[]}));
 etoro.get.mockResolvedValueOnce({instrumentId:77,symbol:raw+'/USD',intervals:[{interval:'1d',candles:100}]})
 .mockResolvedValueOnce({instrumentId:77,symbol:raw+'/USD',interval:'1d',side:'bid',pagination:{hasNext:false},results:days.map(date=>({time:date+'T00:00:00Z',close:10}))})
 .mockResolvedValueOnce({interval:'OneDay',candles:[{instrumentId:77,candles:days.map(date=>({instrumentId:77,fromDate:date+'T00:00:00Z',open:10,high:11,low:9,close:10,volume:0}))}]});
 const result=await request({symbol,instrumentType:'stock',from:'2023-05-01',to:'2023-05-05',connection:{id:'connection',externalAccountId:'1234'}});
 expect(result).toHaveLength(3);expect(result[0]).toMatchObject({currency:'USD',nativeEvidence:'statement-usd-unsplit'});
 expect(db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT * FROM trades'))[1]).toEqual(['synthetic','connection','eToro ****1234',symbol===raw?[symbol]:[symbol,raw]]);
});
