const {underlying,scale}=require('../src/services/cryptoPriceUnits');
test('SHIBXM fallback prices and volumes use documented million-coin lot',()=>{
 expect(underlying('shibxm')).toEqual({symbol:'SHIB',units:1000000});
 const raw={open:.00001,high:.00003,low:.000005,close:.00002,volume:2000000,time:1};const result=scale([raw],1000000)[0];
 expect(result).toMatchObject({open:10,high:30,low:5,close:20,volume:2,time:1});expect(raw.close).toBe(.00002);
});
test.each(['SHIB','BTC','OTHER'])('other crypto quote %s retains its own unit',symbol=>expect(underlying(symbol)).toEqual({symbol,units:1}));
const {parseDailyCsv}=require('../src/services/brokerSync/krakenArchivePrices');
const stamp=Date.parse('2021-01-01')/1000;
test('archive preserves actual USD OHLCV and daily close',()=>expect(parseDailyCsv([stamp,1,3,.5,2,100,4].join(','))).toEqual({prices:{'2021-01-01':2},candles:[{time:stamp,open:1,high:3,low:.5,close:2,volume:100}]}));
test.each([[stamp+1,1,3,.5,2,100,4],[stamp,1,.5,.5,2,100,4],[stamp,1,3,2,2,100,4],[stamp,1,3,.5,2,-1,4],[stamp,1,3,.5,2,100,NaN],[stamp,1,3,.5,0,100,4]])('invalid archive candle is rejected %#',(...row)=>expect(()=>parseDailyCsv(row.join(','))).toThrow(/Invalid/));
test('duplicate archive date cannot replace a price',()=>expect(()=>parseDailyCsv(Array(2).fill([stamp,1,3,.5,2,100,4].join(',')).join('\n'))).toThrow(/Duplicate/));
const {archiveSegments}=require('../src/services/cryptoPriceUnits');
test.each([['A','EOS','2025-03-17'],['POL','MATIC','2023-10-24'],['S','FTM','2024-12-17']])('pre-launch %s history uses exact predecessor and stops at evidence boundary',(symbol,old,until)=>{
 const next=new Date(Date.parse(until)+86400000).toISOString().slice(0,10);
 expect(archiveSegments(symbol,'2021-01-01',next)).toEqual([{symbol:old,from:'2021-01-01',to:until},{symbol,from:next,to:next}]);
 expect(archiveSegments(symbol,next,next)).toEqual([{symbol,from:next,to:next}]);
});
test('unregistered crypto does not invent a predecessor',()=>expect(archiveSegments('OTHER','2021-01-01','2022-01-01')).toEqual([{symbol:'OTHER',from:'2021-01-01',to:'2022-01-01'}]));
