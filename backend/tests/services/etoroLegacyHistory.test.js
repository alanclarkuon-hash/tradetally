jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn()}));
jest.mock('../../src/services/brokerSync/etoroService',()=>({get:jest.fn(),field:(o,k)=>o?.[k]??o?.[k.replace('Id','ID')]}));
const {etoroLegacyDaily}=require('../../src/services/brokerHistoryProviders');
const start=Date.parse('2024-06-03');
const rows=()=>Array.from({length:20},(_,i)=>({instrumentID:77,fromDate:new Date(start+i*86400000).toISOString(),open:10,high:11,low:9,close:10,volume:2}));
const payload=()=>({interval:'OneDay',candles:[{instrumentId:77,candles:rows()}]});
const reference=()=>({currency:'USD',splits:[{date:'2024-06-10',ratio:10}],prices:[0,1,4].map(i=>({date:new Date(start+i*86400000).toISOString().slice(0,10),close:100}))});
const run=(d=payload(),r=reference(),currency='USD')=>etoroLegacyDaily(d,77,currency,r,'2024-06-03','2024-06-30');
test('dated independent split-adjusted anchors allow only the proven interval and bounded tail',()=>{
 const result=run();expect(result).toHaveLength(7);expect(result[0]).toMatchObject({close:10,currency:'USD'});expect(result.at(-1).time).toBe((start+6*86400000)/1000);
});
test.each(['conflict','wrongId','mixedOhlc','nonMidnight','duplicate','wrongCurrency','tooFew','invalidSplit','wrongInterval'])('rejects %s alternate-feed evidence',mode=>{
 const d=payload(),r=reference();let currency='USD';
 if(mode==='conflict')r.prices[1].close=90;
 if(mode==='wrongId')d.candles[0].candles[1].instrumentID=78;
 if(mode==='mixedOhlc')d.candles[0].candles[1].low=99;
 if(mode==='nonMidnight')d.candles[0].candles[1].fromDate='2024-06-04T21:00:00Z';
 if(mode==='duplicate')d.candles[0].candles.push({...d.candles[0].candles[0],close:9.5});
 if(mode==='wrongCurrency')currency='GBP';
 if(mode==='tooFew')r.prices.pop();
 if(mode==='invalidSplit')r.splits[0].ratio=Infinity;
 if(mode==='wrongInterval')d.interval='OneHour';
 expect(run(d,r,currency)).toEqual([]);
});
test('minor-unit prices normalize using explicit native currency, never settlement currency',()=>{
 const r=reference();r.currency='GBP';for(const row of r.prices)row.close/=100;
 expect(run(payload(),r,'GBX')[0]).toMatchObject({close:.1,currency:'GBP'});
});
test('a recorded split inside the anchored interval must match its later share basis',()=>{
 const r=reference();r.prices.push({date:'2024-06-11',close:10});expect(run(payload(),r)).toHaveLength(16);
 r.prices.at(-1).close=100;const verified=run(payload(),r);expect(verified).toHaveLength(7);expect(verified.every(c=>c.time<Date.parse('2024-06-10')/1000)).toBe(true);
});
test('current day and earlier unproven rows are excluded',()=>{
 jest.useFakeTimers().setSystemTime(new Date('2024-06-07T12:00:00Z'));
 expect(run()).toHaveLength(4);jest.useRealTimers();
});

test('a contradictory reference splits independently verified segments and is never crossed',()=>{
 const r={currency:'USD',splits:[],prices:[0,1,2,3,4,5,6].map(i=>({date:new Date(start+i*86400000).toISOString().slice(0,10),close:i===3?20:10}))};
 const result=run(payload(),r);
 expect(result.filter(c=>c.time<(start+4*86400000)/1000)).toHaveLength(3);
 expect(result.some(c=>c.time===(start+3*86400000)/1000)).toBe(false);
 expect(result.at(-1).time).toBe((start+13*86400000)/1000);
});

