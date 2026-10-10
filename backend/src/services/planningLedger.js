
const crypto = require('crypto');
const {fail} = require('./tradePlanning');
const positive = v => Number.isFinite(Number(v)) && Number(v)>0;
function sourceFills(trade) {
 let executions=trade.executions;
 if(typeof executions==='string'){try{executions=JSON.parse(executions)}catch{executions=[]}}
 const input=Array.isArray(executions)&&executions.length?executions:[
  {action:trade.side==='short'?'sell':'buy',quantity:trade.quantity,price:trade.entry_price,datetime:trade.entry_time,commission:trade.entry_commission??(Number(trade.commission||0)-Number(trade.exit_commission||0)),fees:trade.fees},
  ...(trade.exit_time?[{action:trade.side==='short'?'buy':'sell',quantity:trade.quantity,price:trade.exit_price,datetime:trade.exit_time,commission:trade.exit_commission}]:[])
 ];
 const list=input.flatMap(e=>{
  if(e.price!=null&&e.action)return [e];
  if(e.entryPrice==null)return [e];
  const entry={...e,action:trade.side==='short'?'sell':'buy',price:e.entryPrice,datetime:e.entryTime,commission:e.entryCommission??e.commission,fees:e.fees};
  const exit=e.exitPrice!=null?{...e,action:trade.side==='short'?'buy':'sell',price:e.exitPrice,datetime:e.exitTime,commission:e.exitCommission,fees:0}:null;
  if(e.id){entry.id=e.id+':entry';if(exit)exit.id=e.id+':exit'}
  return [entry,...(exit?[exit]:[])];
 });
 const currency=trade.original_entry_price_currency!=null?'USD':trade.original_currency||null;
 const multiplier=trade.instrument_type==='option'?Number(trade.contract_size):trade.instrument_type==='future'?Number(trade.point_value):1;
 const fills=list.map(e=>{
  const action=String(e.action||e.side||'').toLowerCase();
  const kind=(trade.side==='short'?action==='sell':action==='buy')?'entry':(trade.side==='short'?action==='buy':action==='sell')?'exit':null;
  const time=e.datetime||e.timestamp||e.execution_time;
  if(!kind||!positive(e.quantity)||!positive(e.price)||!time||!Number.isFinite(new Date(time).getTime())||!positive(multiplier))return null;
  const snapshot={action:kind,quantity:Number(e.quantity),price:Number(e.price),time:new Date(time).toISOString(),currency,multiplier,
    costs:Number(e.commission||0)+Number(e.fees||e.fee||0),tradeSide:trade.side,instrument:trade.instrument_type||'stock',
    contract:trade.instrument_type==='option'?{symbol:trade.symbol,strike:trade.strike_price,expiry:trade.expiration_date?new Date(trade.expiration_date).toISOString().slice(0,10):'',type:trade.option_type}:null};
  if(!Number.isFinite(snapshot.costs)||snapshot.costs<0)return null;
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const id=e.execution_id||e.executionId||e.fill_id||e.id;
  return {...snapshot,key:id?'id:'+String(id):'hash:'+fingerprint,fingerprint};
 }).filter(Boolean);
 const totalCosts=fills.reduce((sum,f)=>sum+f.costs,0);
 const aggregateKnown=trade.commission!=null||trade.fees!=null;
 const aggregateCosts=Number(trade.commission||0)+Number(trade.fees||0);
 const costsVerified=!aggregateKnown||Math.abs(totalCosts-aggregateCosts)<.000001;
 fills.forEach(f=>{f.costsVerified=costsVerified;});
 const counts=new Map();fills.forEach(f=>counts.set(f.key,(counts.get(f.key)||0)+1));
 return fills.filter(f=>counts.get(f.key)===1);
}
function verifyAllocation(plan,fill,quantity,used,action,stageKey,trade) {
 if(!positive(quantity)||quantity+used>fill.quantity+1e-8)fail('Allocation exceeds the available source-fill quantity',409);
 if(fill.action!==action)fail('Choose a matching entry or exit fill');
 const rows=action==='entry'?plan.definition.entries:plan.definition.exits;
 if(!rows.some(r=>r.key===stageKey)&&!(action==='exit'&&stageKey==='runner'))fail('Ladder row not found');
 const symbol=trade.underlying_symbol||trade.symbol;
 if(String(symbol).toUpperCase()!==plan.definition.symbol.toUpperCase())fail('Trade asset does not match this plan');
 const expected=plan.definition.instrument==='option'?'option':plan.definition.instrument==='crypto'?'crypto':plan.definition.instrument==='spread_bet'?'spread_bet':'stock';
 if((trade.instrument_type||'stock')!==expected)fail('Trade instrument does not match this plan');
 if(expected!=='option'&&trade.side!==plan.definition.direction)fail('Trade direction does not match this plan');
 if(expected==='option'){
  const o=plan.definition.options;
  if(!o.contract||!o.strike||!o.expiry)fail('Select an exact option contract before linking executions');
  if(trade.side!=='long'||Number(trade.strike_price)!==o.strike||new Date(trade.expiration_date).toISOString().slice(0,10)!==o.expiry.slice(0,10)||trade.option_type!==o.type||fill.multiplier!==o.multiplier)fail('Option contract does not match the selected contract');
 }
}
function ledger(plan,allocations,trades) {
 const byId=new Map(trades.map(t=>[t.id,t]));let unresolved=0;
 const provisional=[];
 const conversion=plan.provisionalConversion;
 const convert=conversion&&Number.isFinite(conversion.rate)&&conversion.rate>0&&conversion.currency;
 for(const action of ['entry','exit'])for(const [key,row] of Object.entries(plan.management?.[action]||{})){
  if(row.executed&&!allocations.some(a=>a.action===action&&a.stage_key===key)&&positive(row.units)&&positive(row.price)){
   provisional.push({id:'provisional:'+action+':'+key,trade_id:'provisional',source_key:key,stage_key:key,action,quantity:row.units,
    source_snapshot:{action,quantity:row.units,price:convert?row.price*conversion.rate:row.price,time:row.time,currency:convert?conversion.currency:plan.definition.currency,...(convert?{originalPrice:row.price,originalCurrency:plan.definition.currency,fxRate:conversion.rate}:{}),
    multiplier:plan.definition.instrument==='option'?plan.definition.options.multiplier:plan.definition.instrument==='spread_bet'?1/plan.definition.pointSize:1,
    costs:0,tradeSide:plan.definition.instrument==='option'?'long':plan.definition.direction,instrument:plan.definition.instrument,contract:null,provisional:true}});
  }
 }
 const records=[...allocations,...provisional].map(a=>{
  const fill=sourceFills(byId.get(a.trade_id)||{}).find(f=>f.key===a.source_key);
  const valid=a.source_snapshot.provisional||(fill&&fill.fingerprint===a.source_snapshot.fingerprint&&fill.costsVerified===a.source_snapshot.costsVerified);
  if(!valid)unresolved++;
  return {...a,valid:!!valid,fill:a.source_snapshot,quantity:Number(a.quantity)};
 }).sort((a,b)=>a.fill.time.localeCompare(b.fill.time)||(a.action!==b.action?(a.action==='entry'?-1:1):String(a.id).localeCompare(String(b.id))));
 const queues=new Map();let entered=0,exited=0,cost=0,realised=0,entryCost=0,fees=0,overExit=false;
 const currencies=new Set(records.map(a=>a.fill.currency));
 for(const a of records){
  const f=a.fill,q=a.quantity,fee=f.costs*q/f.quantity;
  const accountKey=plan.definition.accountId||byId.get(a.trade_id)?.account_identifier||a.trade_id;
  const key=accountKey+'|'+JSON.stringify(f.contract?[f.contract.type,Number(f.contract.strike),f.contract.expiry]:null)+'|'+f.currency;
  const queue=queues.get(key)||[];queues.set(key,queue);
  if(a.action==='entry'){
   a.positionValue=a.valid&&f.currency&&f.instrument!=='spread_bet'?q*f.price*f.multiplier:null;
   entered+=q;if(!a.stage_key.startsWith('roll_'))entryCost+=q*f.price*f.multiplier;fees+=fee;queue.push({q,price:f.price,multiplier:f.multiplier,feePerUnit:fee/q});
  }else{
   exited+=q;let remaining=q;let gross=0,entryFees=0;
   while(remaining>1e-8&&queue.length){
    const first=queue[0],matched=Math.min(first.q,remaining);
    gross+=matched*(f.tradeSide==='short'?first.price-f.price:f.price-first.price)*first.multiplier;
    entryFees+=matched*first.feePerUnit;remaining-=matched;first.q-=matched;if(first.q<=1e-8)queue.shift();
   }
   if(remaining>1e-8)overExit=true;
   a.realisedProfit=gross-entryFees-fee;
   realised+=a.realisedProfit;
  }
 }
 for(const queue of queues.values())for(const lot of queue)cost+=lot.q*lot.price*lot.multiplier;
 const openQuantity=entered-exited;
 const currency=currencies.size===1?[...currencies][0]:null;
 const costsUnresolved=records.filter(a=>a.fill.costsVerified===false).length;
 const complete=records.length>0&&!unresolved&&!overExit&&!costsUnresolved&&currencies.size===1&&!!currency;
 for(const a of records)if(a.action==='exit'&&!complete)a.realisedProfit=null;
 const avg=openQuantity>1e-8?cost/openQuantity/(plan.definition.instrument==='option'?plan.definition.options.multiplier:1):null;
 const stop=Number(plan.definition.stopPrice)*(plan.stopConversion||1);
 const capitalRisk=complete&&(plan.definition.currency===currency||plan.stopConversion)&&['stock','crypto'].includes(plan.definition.instrument)&&stop>0
  ? [...queues.values()].flat().reduce((s,l)=>s+l.q*Math.max(0,plan.definition.direction==='short'?stop-l.price:l.price-stop)*l.multiplier,0):null;
 return {records,unresolved,overExit,currency,entered,exited,openQuantity,averagePrice:avg,positionValue:cost,
  realisedProfit:complete?realised:null,percentGain:complete&&entryCost>0?realised/entryCost*100:null,
  originalRisk:plan.baseline?.originalRisk??plan.baseline?.riskBudget??null,originalRiskCurrency:plan.baseline?.originalRiskCurrency??plan.baseline?.currency??null,
  realisedR:complete&&(plan.baseline?.originalRiskCurrency||plan.baseline?.currency)===currency&&(plan.baseline?.originalRisk||plan.baseline?.riskBudget)>0?realised/(plan.baseline.originalRisk||plan.baseline.riskBudget):null,
  capitalRisk,costsUnresolved,provisionalCount:provisional.length,fxEstimated:!!(convert&&provisional.length),economicallyClosed:complete&&!provisional.length&&Math.abs(openQuantity)<1e-8,coverageComplete:complete&&!provisional.length,entryCost,entryFees:fees};
}
module.exports={sourceFills,verifyAllocation,ledger};
