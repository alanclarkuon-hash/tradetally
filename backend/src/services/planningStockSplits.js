// Normalize economic views only. Source fills, allocations and fingerprints stay native.
const dateOnly=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function normalize(plan,records,trades,asOf){
 const byId=new Map(trades.map(t=>[t.id,t])),evidence=trades.planningSplits||{},events=new Map(),invalid=new Set();
 if(plan.definition.instrument==='stock')for(const record of records){
  const trade=byId.get(record.trade_id),symbol=trade?.symbol;
  if(!symbol||record.fill.instrument!=='stock'||!Object.hasOwn(evidence,symbol))continue;
  const market=evidence[symbol],splits=market?.splits;
  if(!Array.isArray(splits)||!splits.every(s=>dateOnly(s.date)&&Number.isFinite(s.ratio)&&s.ratio>0)||new Set(splits.map(s=>s.date)).size!==splits.length||(splits.length&&market.currency!==record.fill.currency)){invalid.add(symbol);continue}
  events.set(symbol,splits.filter(s=>s.date<=asOf).sort((a,b)=>a.date.localeCompare(b.date)));
 }
 const factor=(symbol,from)=>(events.get(symbol)||[]).filter(s=>s.date>from).reduce((v,s)=>v*s.ratio,1);
 const adjusted=records.map(a=>{
  const symbol=byId.get(a.trade_id)?.symbol,ratio=factor(symbol,a.fill.time.slice(0,10));
  if(!Number.isFinite(ratio)||ratio<=0||!Number.isFinite(a.quantity*ratio)||!Number.isFinite(a.fill.quantity*ratio)||!Number.isFinite(a.fill.price/ratio)){invalid.add(symbol);return {...a,sourceQuantity:a.quantity,splitFactor:1}}
  return {...a,sourceQuantity:a.quantity,splitFactor:ratio,...(ratio!==1?{quantity:a.quantity*ratio,fill:{...a.fill,sourceQuantity:a.fill.quantity,sourcePrice:a.fill.price,quantity:a.fill.quantity*ratio,price:a.fill.price/ratio,...(a.fill.economicPrice!=null?{economicPrice:a.fill.economicPrice/ratio}:{})}}:{})};
 });
 const active=[...events.values()].some(list=>list.length);
 function matchFactor(own,savedBasis){
  if(!active)return 1;
  if(savedBasis!=null&&!dateOnly(savedBasis))return null;
  const factors=own.map(a=>savedBasis?factor(byId.get(a.trade_id)?.symbol,savedBasis):a.splitFactor);
  return factors.length&&factors.every(f=>f===factors[0])?factors[0]:null;
 }
 return {records:adjusted,unresolved:records.filter(a=>invalid.has(byId.get(a.trade_id)?.symbol)).length,basisDate:active?asOf:null,adjusted:adjusted.some(a=>a.splitFactor!==1),matchFactor};
}
module.exports={normalize};
