jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/models/BrokerConnection', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/brokerSync/etoroService', () => ({ get: jest.fn(), field: (o,k) => o?.[k] }));
const registry = require('../../src/services/brokerHistoryProviders');
const db = require('../../src/config/database');
const BC = require('../../src/models/BrokerConnection');
beforeEach(() => { jest.resetAllMocks(); });
test('adding a broker adapter requires no orchestrator change and uses remaining ranges', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'one', broker_type: 'new-broker' }, { id: 'two', broker_type: 'another' }] });
  BC.findById.mockResolvedValue({});
  let ranges = [{ from: '2026-08-01', to: '2026-08-01' }];
  const first = jest.fn().mockResolvedValue([{ time: Date.parse('2026-08-01') / 1000, close: 1 }]);
  const second = jest.fn();
  registry.adapters.set('new-broker', first); registry.adapters.set('another', second);
  await registry.fetch({ userId: 'owner', symbol: 'COIN', instrumentType: 'crypto', ranges: () => ranges, onPrices: async () => { ranges = []; } });
  expect(first).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-08-01', symbol: 'COIN' }));
  expect(second).not.toHaveBeenCalled();
  registry.adapters.delete('new-broker'); registry.adapters.delete('another');
});
test('a broker failure falls through without disclosing its error object', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'one', broker_type: 'failure-broker' }] });
  BC.findById.mockResolvedValue({});
  registry.adapters.set('failure-broker', async () => { throw Error('secret request headers'); });
  await expect(registry.fetch({ userId: 'owner', symbol: 'COIN', instrumentType: 'crypto', ranges: () => [{ from: '2026-08-01', to: '2026-08-01' }], onPrices: jest.fn() })).resolves.toBeUndefined();
  registry.adapters.delete('failure-broker');
});
test('uncommitted and out-of-range candles never enter broker history', () => {
  const current = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.parse(current)-86400000).toISOString().slice(0,10);
  const result = registry.bounded([registry.candle(Date.parse(current), [1,1,1,1,0]), registry.candle(Date.parse(yesterday), [1,1,1,1,0])], yesterday, current);
  expect(result).toHaveLength(1);
  expect(registry.candle(Date.parse(current), [1,1,1,NaN,0])).toBeNull();
});
test('eToro verifies stable instrument ID, explicit USD units and bounded cursor pages', async () => {
  db.query.mockResolvedValue({ rows: [{ payload: { instruments: [{ instrumentId: 1, symbolFull: 'BTC',instrumentTypeId:2 }],instrumentTypes:[{instrumentTypeId:2,instrumentTypeDescription:'Crypto'}] } }] });
  const etoro = require('../../src/services/brokerSync/etoroService');
  etoro.get.mockResolvedValueOnce({instrumentId:1,intervals:[{interval:'1d',candles:1}]}).mockResolvedValueOnce({ instrumentId: 1, symbol: 'BTC/USD', interval:'1d',side:'bid',results: [{ time: '2026-01-01T00:00:00Z', open: 10, high: 10, low: 10, close: 10, volume: 0 }], pagination: { hasNext: false } });
  expect(await registry.etoroCandles({ symbol: 'BTC', instrumentType: 'crypto', from: '2026-01-01', to: '2026-01-01', userId: 'owner', connection: { id: 'conn' } })).toHaveLength(1);
  expect(etoro.get.mock.calls[1][1]).toBe('/data/instruments/1/candles');
});

test('equity instruments reach extensible broker adapters before provider fallback',async()=>{
 db.query.mockResolvedValue({rows:[{id:'conn',broker_type:'equity-capability'}]}); BC.findById.mockResolvedValue({});
 const adapter=jest.fn().mockResolvedValue([]);registry.adapters.set('equity-capability',adapter);
 await registry.fetch({userId:'owner',symbol:'STOCK',instrumentType:'stock',ranges:()=>[{from:'2021-10-15',to:'2021-10-15'}],onPrices:jest.fn()});
 expect(adapter).toHaveBeenCalledWith(expect.objectContaining({instrumentType:'stock'}));registry.adapters.delete('equity-capability');
});
test('eToro validates session date, currency and split scale against permanent reference evidence',()=>{
 const reference={currency:'USD',prices:[{date:'2024-06-07',close:1206.4}],splits:[{date:'2024-06-10',ratio:10}]};
 const row={time:'2024-06-06T21:00:00Z',open:1192,high:1214,low:120.64,close:120.64};
 expect(registry.etoroDaily(row,'stock','USD',reference)).toEqual(expect.objectContaining({time:Date.parse('2024-06-07')/1000,close:120.64}));
 expect(registry.etoroDaily({...row,close:1206.4},'stock','USD',reference).close).toBeCloseTo(120.64,10);
 expect(registry.etoroDaily(row,'stock','HKD',reference)).toBeNull();
 expect(registry.etoroDaily({...row,close:999},'stock','USD',reference)).toBeNull();
 expect(registry.etoroDaily(row,'stock','USD',null)).toBeNull();
 expect(registry.etoroDaily(row,'crypto','USD',null)).toBeNull();
});
test('eToro discovers a historical equity missing from the recent snapshot and uses its native currency',async()=>{
 const etoro=require('../../src/services/brokerSync/etoroService');
 db.query.mockResolvedValueOnce({rows:[{payload:{instruments:[],instrumentTypes:[{instrumentTypeId:1,instrumentTypeDescription:'Stocks'}]}}]}).mockResolvedValueOnce({rows:[{payload:{currency:'HKD',prices:[{date:'2021-10-15',close:500}],splits:[]}}]});
 etoro.get.mockResolvedValueOnce({items:[{instrumentId:23,instrumentTypeId:1,internalSymbolFull:'0700.HK'},{instrumentId:9,internalSymbolFull:'WRONG'}]})
 .mockResolvedValueOnce({instrumentId:23,intervals:[{interval:'1d',candles:20}]})
 .mockResolvedValueOnce({instrumentId:23,symbol:'0700.HK/HKD',interval:'1d',side:'bid',results:[{time:'2021-10-14T21:00:00Z',close:500}],pagination:{hasNext:false}});
 expect(await registry.etoroCandles({symbol:'0700.HK',instrumentType:'stock',from:'2021-10-15',to:'2021-10-15',userId:'owner',connection:{id:'conn'}})).toEqual([expect.objectContaining({close:500,time:Date.parse('2021-10-15')/1000})]);
 expect(etoro.get.mock.calls[2][2].from).toBe('2021-10-14T00:00:00.000Z');
});
test('eToro history rejects a same-ticker equity when asked for a coin',async()=>{
 db.query.mockResolvedValue({rows:[{payload:{instruments:[{symbolFull:'SUI',instrumentId:1,instrumentTypeId:1}],instrumentTypes:[{instrumentTypeId:1,instrumentTypeDescription:'Stocks'}]}}]});
 expect(await registry.etoroCandles({symbol:'SUI',instrumentType:'crypto',from:'2026-01-01',to:'2026-01-02',userId:'owner',connection:{id:'conn'}})).toEqual([]);
 expect(require('../../src/services/brokerSync/etoroService').get).not.toHaveBeenCalled();
});
test('UTC broker bars reject invalid OHLC and non-UTC daily boundaries',()=>{
 expect(registry.candle(Date.parse('2026-01-01T21:00:00Z'),[1,2,1,1,0])).toBeNull();
 expect(registry.candle(Date.parse('2026-01-01'),[10,11,9,100,0])).toBeNull();
});
test('Kraken discards its final uncommitted row even when dated in the past',async()=>{
 jest.useFakeTimers();const axios=require('axios');
 axios.get.mockResolvedValueOnce({data:{result:{PAIR:{wsname:'SUI/USD'}}}})
 .mockResolvedValueOnce({data:{result:{PAIR:[['1704067200','1','1','1','1','1','0','1'],['1704153600','2','2','2','2','2','0','1']],last:1704153600}}});
 const pending=registry.kraken({symbol:'SUI',instrumentType:'crypto',from:'2024-01-01',to:'2024-01-03'});
 await jest.runAllTimersAsync();const result=await pending;expect(result.map(c=>c.close)).toEqual([1]);jest.useRealTimers();
});
test('OKX keeps only confirmed UTC bars and converts USDT with the dated broker USD index',async()=>{
 jest.useFakeTimers();const axios=require('axios');const time=Date.parse('2024-01-01');
 axios.get.mockResolvedValueOnce({data:{code:'0',data:[{instId:'TEST-USDT',baseCcy:'TEST',quoteCcy:'USDT'}]}})
 .mockResolvedValueOnce({data:{code:'0',data:[[String(time),'2','2','2','2','5','10','10','1'],[String(time+86400000),'3','3','3','3','5','10','10','0']]}})
 .mockResolvedValueOnce({data:{code:'0',data:[[String(time),'0.98','0.98','0.98','0.98','1']]}});
 const pending=registry.okx({symbol:'TEST',instrumentType:'crypto',from:'2024-01-01',to:'2024-01-02',connection:{brokerEnvironment:'us'}});
 await jest.runAllTimersAsync();const result=await pending;expect(result.map(c=>c.close)).toEqual([1.96]);
 expect(axios.get.mock.calls.at(-1)[0]).toBe('https://us.okx.com/api/v5/market/history-index-candles');jest.useRealTimers();
});
