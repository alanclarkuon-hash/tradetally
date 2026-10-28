// Row matches describe strategy intent; journal trade pairs are navigation anchors.
const quantityMath=require('./planningQuantity');
const contract=f=>JSON.stringify(f.contract?[f.contract.type,Number(f.contract.strike),f.contract.expiry]:null);
const account=(plan,a)=>require('./planningAccounts').stageAccount(plan.definition,a.action,a.stage_key)||a.accountKey;
function eligibleEntries(plan,records,own){
 return records.filter(a=>a.action==='entry'&&own.some(e=>account(plan,a)===account(plan,e)&&a.fill.currency===e.fill.currency&&contract(a.fill)===contract(e.fill)&&(!e.brokerPositionId||a.brokerPositionId===e.brokerPositionId)&&a.fill.time<=e.fill.time));
}
function prepare(plan,records){
 const exits=[...new Set(records.filter(a=>a.action==='exit').map(a=>a.stage_key))];
 return exits.map(exitKey=>{
  const own=records.filter(a=>a.action==='exit'&&a.stage_key===exitKey),quantity=own.reduce((q,a)=>q+a.quantity,0);
  const eligible=eligibleEntries(plan,records,own);
  const options=[...new Set(eligible.map(a=>a.stage_key))].map(entryKey=>({entryKey,quantity:eligible.filter(a=>a.stage_key===entryKey).reduce((q,a)=>q+a.quantity,0)}));
  const saved=plan.management?.exit?.[exitKey]?.entryMatches,explicit=Array.isArray(saved);
  const matches=explicit?saved.map(m=>({...m})):options.length===1?[{entryKey:options[0].entryKey,quantity}]:[];
  const total=matches.reduce((q,m)=>q+Number(m.quantity||0),0),unique=new Set(matches.map(m=>m.entryKey));
  const valid=matches.length>0&&unique.size===matches.length&&matches.every(m=>typeof m.entryKey==='string'&&Number.isFinite(m.quantity)&&m.quantity>0&&options.some(o=>o.entryKey===m.entryKey))&&quantityMath.equal(total,quantity);
  return {exitKey,quantity,options,matches,explicit,status:valid?'matched':'needs_match',reason:valid?null:'Choose entry rows and quantities for this exit'};
 });
}
function consume(queue,row,a){
 if(!row||row.status!=='matched')return null;
 if(!row.balance)Object.defineProperty(row,'balance',{value:new Map(row.matches.map(m=>[m.entryKey,m.quantity]))});
 const eligible=row.matches.map(match=>{
  const lots=queue.filter(l=>l.stageKey===match.entryKey&&l.q>0&&(!a.brokerPositionId||l.brokerPositionId===a.brokerPositionId));
  const available=lots.reduce((q,l)=>q+l.q,0);
  return {entryKey:match.entryKey,lots,available,capacity:Math.min(row.balance.get(match.entryKey),available)};
 }).filter(m=>m.capacity>0);
 // Repeated subtraction can cancel digits from a small final fragment.
 // Carry the original exit row magnitude into the machine-error guard only.
 const capacity=eligible.reduce((q,m)=>q+m.capacity,0);if(!eligible.length||quantityMath.exceeds(a.quantity,capacity,row.quantity))return null;
 const pieces=[],used=[],matchedQuantity=Math.min(a.quantity,capacity);let unassigned=matchedQuantity;
 for(const [index,match]of eligible.entries()){
  const wanted=index===eligible.length-1?unassigned:Math.min(unassigned,match.capacity,matchedQuantity*match.capacity/capacity);
  let remaining=wanted;
  for(const [i,lot]of match.lots.entries()){
   const q=Math.min(lot.q,i===match.lots.length-1?remaining:Math.min(remaining,wanted*lot.q/match.available));
   if(q>0){pieces.push({lot,q});remaining-=q;}
  }
  used.push({entryKey:match.entryKey,quantity:wanted});unassigned-=wanted;
 }
 if(!quantityMath.equal(pieces.reduce((q,p)=>q+p.q,0),a.quantity,row.quantity))return null;
 for(const m of used)row.balance.set(m.entryKey,Math.max(0,row.balance.get(m.entryKey)-m.quantity));
 for(const p of pieces)p.lot.q-=p.q;
 // Only exhausted lots leave the queue. The matching allowance is not a
 // dust threshold and must not discard a separate real minimum-sized entry.
 for(let i=queue.length-1;i>=0;i--)if(queue[i].q<=0)queue.splice(i,1);
 return pieces;
}
// Availability is a view of verified source consumption, not a new allocation.
// Include this exit's own units so reopening its editor does not lose its match.
function availability(plan,rows,records){
 for(const row of rows){
  const own=records.filter(a=>a.action==='exit'&&a.stage_key===row.exitKey);
  const eligible=eligibleEntries(plan,records,own);
  row.options=row.options.map(option=>{
   const sources=eligible.filter(a=>a.stage_key===option.entryKey);
   const assignedQuantity=records.filter(a=>a.action==='exit'&&a.stage_key!==row.exitKey).reduce((sum,a)=>sum+(a.matchedEntries||[]).filter(m=>m.entryKey===option.entryKey&&sources.some(e=>e.trade_id===m.tradeId&&e.source_key===m.sourceKey)).reduce((q,m)=>q+m.quantity,0),0);
   return {...option,totalQuantity:option.quantity,assignedQuantity,quantity:Math.max(0,option.quantity-assignedQuantity)};
  });
 }
}
function remember(plan,result){
 const management=JSON.parse(JSON.stringify(plan.management||{}));management.exit??={};
 for(const row of result.entryMatching||[])if(row.status==='matched'&&!row.explicit){management.exit[row.exitKey]={...management.exit[row.exitKey],entryMatches:row.matches};}
 return management;
}
module.exports={prepare,consume,availability,remember};
