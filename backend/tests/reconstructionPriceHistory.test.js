jest.mock('../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('axios',()=>({get:jest.fn()}));
jest.mock('../src/services/exchangeCalendar',()=>({resolve:jest.fn().mockResolvedValue('US'),isTradingDay:d=>![0,6].includes(new Date(d).getUTCDay())}));
jest.mock('../src/services/portfolioService',()=>({_getDailySeries:jest.fn()}));
jest.mock('../src/utils/currencyConverter',()=>({getForexRate:jest.fn().mockResolvedValue(1)}));
const db=require('../src/config/database'),axios=require('axios'),portfolio=require('../src/services/portfolioService');
const {loadMarket}=require('../src/services/portfolioReconstructionService');
let saved;
beforeEach(()=>{jest.clearAllMocks();saved={currency:'USD',from:'2026-01-02',to:'2026-01-02',prices:[{date:'2026-01-02',close:100}],splits:[]};db.query.mockImplementation(async(sql,args)=>{if(sql.startsWith('SELECT payload'))return {rows:[{payload:saved}]};if(sql.startsWith('INSERT'))saved=args[1];return {rows:[]};});db.withTransaction.mockImplementation(fn=>fn(db));axios.get.mockRejectedValue(Error('Unavailable'));portfolio._getDailySeries.mockResolvedValue([{time:Date.parse('2026-01-05')/1000,close:101}]);});
test('later disjoint range merges instead of discarding an earlier saved close',async()=>{const r=await loadMarket('SYNTH','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'});expect(r.prices).toEqual([{date:'2026-01-02',close:100},{date:'2026-01-05',close:101}]);expect(r.from).toBe('2026-01-02');});
test('an envelope does not conceal a missing interior exchange session',async()=>{saved.to='2026-01-06';saved.prices.push({date:'2026-01-06',close:102});const r=await loadMarket('SYNTH','2026-01-02','2026-01-06',{fetchPrices:true,userId:'owner'});expect(portfolio._getDailySeries).toHaveBeenCalledWith('SYNTH','2026-01-05','2026-01-05','owner',expect.any(Object));expect(r.prices.map(p=>p.date)).toEqual(['2026-01-02','2026-01-05','2026-01-06']);});
test('unavailable providers preserve existing coverage without a replacement write',async()=>{portfolio._getDailySeries.mockResolvedValue([]);expect(await loadMarket('SYNTH','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'})).toEqual(saved);expect(db.withTransaction).not.toHaveBeenCalled();});
test('currency or split conflicts preserve saved history',async()=>{axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'SYNTH',currency:'EUR'},timestamp:[],events:{},indicators:{quote:[{}]}}]}}});expect(await loadMarket('SYNTH','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'})).toEqual(saved);expect(db.withTransaction).not.toHaveBeenCalled();});

test('conflicting split ratios cannot revise stored historical price units',async()=>{saved.splits=[{date:'2026-01-05',ratio:2}];axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'SYNTH',currency:'USD'},timestamp:[],events:{splits:{one:{date:Date.parse('2026-01-05')/1000,numerator:3,denominator:1}}},indicators:{quote:[{}]}}]}}});const before=JSON.stringify(saved);await loadMarket('SYNTH','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'});expect(JSON.stringify(saved)).toBe(before);expect(db.withTransaction).not.toHaveBeenCalled();});


test('HK reconstruction uses matching provider metadata but preserves broker/cache identity and older closes',async()=>{
 saved={currency:'HKD',from:'2026-01-02',to:'2026-01-02',prices:[{date:'2026-01-02',close:10}],splits:[]};
 portfolio._getDailySeries.mockResolvedValue([]);
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'0257.HK',currency:'HKD',exchangeName:'HKG'},timestamp:[Date.parse('2026-01-05')/1000],events:{},indicators:{quote:[{close:[11]}]}}]}}});
 const result=await loadMarket('00257.HK','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'});
 expect(axios.get.mock.calls[0][0]).toContain('/0257.HK');
 expect(result.currency).toBe('HKD');expect(result.prices).toEqual([{date:'2026-01-02',close:10},{date:'2026-01-05',close:11}]);
 expect(db.query.mock.calls.find(([sql])=>sql.startsWith('INSERT'))[1][0]).toBe('00257.HK');
});
test.each([{symbol:'0257.HK',currency:'USD',exchangeName:'HKG'},{symbol:'0257.HK',currency:'HKD',exchangeName:'NYSE'},{symbol:'1093.HK',currency:'HKD',exchangeName:'HKG'}])('invalid HK native metadata does not assign a currency or write reconstructed history %#',async(meta)=>{
 saved=null;portfolio._getDailySeries.mockResolvedValue([{time:Date.parse('2026-01-05')/1000,close:10}]);
 axios.get.mockResolvedValue({data:{chart:{result:[{meta,timestamp:[],events:{},indicators:{quote:[{}]}}]}}});
 expect(await loadMarket('00257.HK','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'})).toBeNull();
 expect(db.withTransaction).not.toHaveBeenCalled();
});


test('namespace reconstruction recovers native metadata and rejects pre-listing candles under original key',async()=>{
 saved=null;portfolio._getDailySeries.mockResolvedValue([]);
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'EXAMPLE.AS',currency:'EUR',exchangeName:'AMS',firstTradeDate:Date.parse('2026-01-05')/1000},timestamp:['2026-01-02','2026-01-05'].map(d=>Date.parse(d)/1000),events:{},indicators:{quote:[{close:[10,11]}]}}]}}});
 const result=await loadMarket('EXAMPLE.NV','2026-01-02','2026-01-05',{fetchPrices:true,userId:'owner'});
 expect(result).toMatchObject({currency:'EUR',prices:[{date:'2026-01-05',close:11}]});
 expect(db.query.mock.calls.find(([sql])=>sql.startsWith('INSERT'))[1][0]).toBe('EXAMPLE.NV');
 expect(axios.get.mock.calls[0][0]).toContain('/EXAMPLE.AS');
});


test('native Australian daily prices and splits use exchange session dates',()=>{
 const {parseYahoo}=require('../src/services/portfolioReconstructionService');
 const result=parseYahoo({meta:{currency:'AUD',exchangeTimezoneName:'Australia/Sydney'},timestamp:[Date.parse('2023-01-02T23:00:00Z')/1000],indicators:{quote:[{close:[10]}]},events:{splits:{one:{date:Date.parse('2023-01-03T23:00:00Z')/1000,numerator:2,denominator:1}}}});
 expect(result.prices).toEqual([{date:'2023-01-03',close:20}]);expect(result.splits).toEqual([{date:'2023-01-04',ratio:2}]);
});

test('verified first-trade evidence is saved without rewriting existing closes',async()=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'SYNTH',currency:'USD',exchangeName:'NMS',firstTradeDate:Date.parse('2026-01-02')/1000},timestamp:[],events:{},indicators:{quote:[{}]}}]}}});
 const before=saved.prices[0];const result=await loadMarket('SYNTH','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'});
 expect(result.listing.meta.firstTradeDate).toBe(Date.parse('2026-01-02')/1000);expect(result.prices[0]).toEqual(before);
});
test('shared candles before the verified listing are not inserted',async()=>{
 saved=null;portfolio._getDailySeries.mockResolvedValue(['2026-01-02','2026-01-05'].map(d=>({time:Date.parse(d)/1000,close:10})));
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'SYNTH',currency:'USD',exchangeName:'NMS',firstTradeDate:Date.parse('2026-01-05')/1000},timestamp:[],events:{},indicators:{quote:[{}]}}]}}});
 const result=await loadMarket('SYNTH','2026-01-02','2026-01-05',{fetchPrices:true,userId:'owner'});expect(result.prices.map(p=>p.date)).toEqual(['2026-01-05']);
});
test('modern listing metadata cannot replace evidence for existing older cached prices',async()=>{
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'SYNTH',currency:'USD',exchangeName:'NMS',firstTradeDate:Date.parse('2026-01-05')/1000},timestamp:[],events:{},indicators:{quote:[{}]}}]}}});
 const result=await loadMarket('SYNTH','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'});expect(result.listing).toBeUndefined();expect(result.prices[0]).toEqual({date:'2026-01-02',close:100});
});

test('a failed pre-IPO range reads lifetime metadata once and retains existing prices',async()=>{
 saved={currency:'USD',from:'2026-01-05',to:'2026-01-05',prices:[{date:'2026-01-05',close:100}],splits:[]};portfolio._getDailySeries.mockResolvedValue([]);
 axios.get.mockRejectedValueOnce(Error('No pre-IPO history')).mockResolvedValueOnce({data:{chart:{result:[{meta:{symbol:'SYNTH',currency:'USD',exchangeName:'NMS',firstTradeDate:Date.parse('2026-01-05')/1000}}]}}});
 const result=await loadMarket('SYNTH','2026-01-02','2026-01-05',{fetchPrices:true,userId:'owner'});
 expect(result.prices).toEqual(saved.prices);expect(result.listing.meta.firstTradeDate).toBe(Date.parse('2026-01-05')/1000);
 expect(axios.get.mock.calls[1][1].params).toEqual({interval:'1d',range:'5d'});
});
test('failed history and incompatible current metadata retain existing evidence',async()=>{
 portfolio._getDailySeries.mockResolvedValue([]);axios.get.mockRejectedValueOnce(Error('Unavailable')).mockResolvedValueOnce({data:{chart:{result:[{meta:{symbol:'OTHER',currency:'USD',exchangeName:'NMS',firstTradeDate:Date.parse('2026-01-02')/1000}}]}}});
 const result=await loadMarket('SYNTH','2026-01-05','2026-01-05',{fetchPrices:true,userId:'owner'});expect(result).toEqual(saved);expect(db.withTransaction).not.toHaveBeenCalled();
});
