jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn()}));
jest.mock('../../src/services/brokerSync/etoroService',()=>({get:jest.fn(),field:(o,k)=>o?.[k]??o?.[k.replace('Id','ID')]}));
const {corroborate}=require('../../src/services/etoroStatementEquityHistory');
const start=Date.parse('2023-05-01');
const payload=()=>({interval:'OneDay',candles:[{instrumentId:77,candles:Array.from({length:20},(_,i)=>({instrumentID:77,fromDate:new Date(start+i*86400000).toISOString(),open:10,high:11,low:9,close:10,volume:0}))}]});
function fixture(){const trades=[0,2,5].map((i,index)=>{const datetime=new Date(start+i*86400000+3600000).toISOString(),id=String(index+1);return {entry_time:datetime,executions:[{type:'entry',datetime,price:10,etoro_native_price:10,etoro_fx:1,etoro_position_id:id,etoro_record_key:'statement:'+id,etoro_statement_source:true}]};});return {trades,profiles:new Map(trades.map(t=>[t,{statementAuthority:true,unsplitCostAuthority:true,currency:'USD',splits:[]}]))};}
const run=(d,f)=>corroborate(d,77,f.trades,f.profiles,'2023-05-01','2023-05-31');
test('independent dated native executions corroborate USD equity history with a bounded tail',()=>{
 const result=run(payload(),fixture());expect(result).toHaveLength(10);expect(result[0]).toMatchObject({currency:'USD',close:10,nativeEvidence:'statement-usd-unsplit'});
});
test.each(['split','currency','unproven','price','conversion','key','time','wrongId','fewDates','invalidBar'])('rejects %s statement corroboration',mode=>{
 const d=payload(),f=fixture(),t=f.trades[0],e=t.executions[0],profile=f.profiles.get(t);
 if(mode==='split')profile.splits=[{date:'2023-05-03',ratio:2}];if(mode==='currency')profile.currency='GBP';if(mode==='unproven')profile.statementAuthority=false;
 if(mode==='price')e.etoro_native_price=e.price=30;if(mode==='conversion')e.price=15;if(mode==='key')e.etoro_record_key='closed:1';if(mode==='time')e.datetime='2023-05-02T12:00:00Z';
 if(mode==='wrongId')d.candles[0].candles[0].instrumentID=78;if(mode==='fewDates')f.trades.pop();if(mode==='invalidBar')d.candles[0].candles[0].high=1;
 expect(run(d,f)).toEqual([]);
});
test('duplicates on one date cannot satisfy independent date proof',()=>{
 const f=fixture();for(const t of f.trades){t.entry_time=f.trades[0].entry_time;t.executions[0].datetime=t.entry_time;}
 expect(run(payload(),f)).toEqual([]);
});



test('corroborated execution basis plus matching detailed closes validates later held sessions',()=>{
 const d=payload(),f=fixture(),row={time:'2023-05-18T21:00:00Z',close:10};
 const result=corroborate(d,77,f.trades,f.profiles,'2023-05-01','2023-05-31',[row]);
 expect(result).toEqual([expect.objectContaining({time:Date.parse('2023-05-19')/1000,close:10})]);
 expect(corroborate(d,77,f.trades,f.profiles,'2023-05-01','2023-05-31',[{...row,close:100}])).toEqual([]);
});

test('a lagging detailed feed permits only a short tail after three corroborated closes',()=>{
 const d=payload(),f=fixture(),native=[14,15,16].map(i=>({time:new Date(start+i*86400000).toISOString(),close:10}));
 const result=corroborate(d,77,f.trades,f.profiles,'2023-05-01','2023-05-31',native);
 expect(result.some(c=>c.time===Date.parse('2023-05-19')/1000)).toBe(true);
 native.push({time:'2023-05-18T00:00:00Z',close:100});
 const rejected=corroborate(d,77,f.trades,f.profiles,'2023-05-01','2023-05-31',native);
 expect(rejected.some(c=>c.time>=Date.parse('2023-05-18')/1000)).toBe(false);
});
