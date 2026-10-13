const {candle,bounded}=require('./brokerHistoryProviders');
const {field}=require('./brokerSync/etoroService');
const DAY=86400000;
function corroborate(data,id,trades,profiles,from,to,nativeRows=[]) {
 if(data?.interval!=='OneDay'||data.candles?.length!==1)return [];
 const group=data.candles[0];if(Number(field(group,'instrumentId'))!==id||!Array.isArray(group.candles)||group.candles.length>1000)return [];
 const prices=new Map();
 for(const row of group.candles){
  if(Number(field(row,'instrumentId'))!==id)return [];
  const c=candle(Date.parse(row.fromDate),[row.open,row.high,row.low,row.close,row.volume]);if(!c)return [];
  const old=prices.get(c.time);if(old&&JSON.stringify(old)!==JSON.stringify(c))return [];
  prices.set(c.time,c);
 }
 const dates=new Set();
 for(const trade of trades){
  const proof=profiles.get(trade);
  if(!proof?.statementAuthority||!proof.unsplitCostAuthority||proof.currency!=='USD'||proof.splits?.length)return [];
  for(const e of trade.executions||[]){
   if(e.etoro_statement_source!==true||Number(e.etoro_fx)!==1||!(Number(e.etoro_native_price)>0)||!(Number(e.price)>0))continue;
   const expected=e.type==='entry'?trade.entry_time:e.type==='exit'?trade.exit_time:null;
   if(!expected||Math.abs(Date.parse(e.datetime)-Date.parse(expected))>=1000||!/^\d+$/.test(String(e.etoro_position_id))||e.etoro_record_key!=='statement:'+e.etoro_position_id||Math.abs(Number(e.price)/Number(e.etoro_native_price)-1)>1e-6)continue;
   const date=String(e.datetime).slice(0,10),time=Date.parse(date)/1000;
   let c=prices.get(time);
   // Weekend or post-delisting settlements can occur after the last broker
   // market session. Corroborate the observed prior bar; never invent a bar
   // or relabel the execution date as a trading session.
   if(!c&&e.type==='exit')c=[...prices.values()].filter(p=>p.time<=time&&time-p.time<=7*DAY/1000&&require('./exchangeCalendar').isTradingDay(new Date(p.time*1000).toISOString().slice(0,10),'US')).sort((a,b)=>a.time-b.time).at(-1);
   if(!c)continue;
   const native=Number(e.etoro_native_price);
   // Native statement executions corroborate the broker's intraday envelope,
   // rather than pretending an execution was the exchange closing price.
   if(native<c.low*.99||native>c.high*1.01)return [];
   dates.add(c.time);
  }
 }
 const anchors=[...dates].sort((a,b)=>a-b);if(anchors.length<3)return [];
 const first=anchors[0],corroboratedEnd=anchors.at(-1),last=corroboratedEnd+7*DAY/1000,paired=new Set(),conflicts=[];
 for(const row of nativeRows){
  const time=Date.parse(row.time),hour=new Date(time).getUTCHours();if(!Number.isFinite(time)||![0,21,22].includes(hour))continue;
  const session=new Date(time+(hour===0?0:DAY)).toISOString().slice(0,10),t=Date.parse(session)/1000,c=prices.get(t),close=Number(row.close);
  if(c&&close>0&&Number.isFinite(close)){if(Math.abs(close/c.close-1)<=.01)paired.add(t);else conflicts.push(t);}
 }
 const latest=[...paired].sort((a,b)=>a-b).at(-1),tailEnd=paired.size>=3?Math.min(latest+7*DAY/1000,...conflicts.filter(t=>t>latest).map(t=>t-1)):null;
 return bounded([...prices.values()].filter(c=>c.time>=first&&(c.time<=last||paired.has(c.time)||tailEnd!=null&&c.time>latest&&c.time<=tailEnd)&&(!nativeRows.length||paired.has(c.time)||tailEnd!=null&&c.time>latest&&c.time<=tailEnd)&&require('./exchangeCalendar').isTradingDay(new Date(c.time*1000).toISOString().slice(0,10),'US')),from,to).map(c=>({...c,currency:'USD',nativeEvidence:'statement-usd-unsplit'})).sort((a,b)=>a.time-b.time);
}
module.exports={corroborate};
