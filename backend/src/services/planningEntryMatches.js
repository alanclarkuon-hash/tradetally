// Row matches describe strategy intent; journal trade pairs are navigation anchors.
const EPS=1e-8;
const contract=f=>JSON.stringify(f.contract?[f.contract.type,Number(f.contract.strike),f.contract.expiry]:null);
function prepare(plan,records){
 const account=a=>require('./planningAccounts').stageAccount(plan.definition,a.action,a.stage_key)||a.accountKey;
 const exits=[...new Set(records.filter(a=>a.action==='exit').map(a=>a.stage_key))];
 return exits.map(exitKey=>{
  const own=records.filter(a=>a.action==='exit'&&a.stage_key===exitKey),quantity=own.reduce((q,a)=>q+a.quantity,0);
  const eligible=records.filter(a=>a.action==='entry'&&own.some(e=>account(a)===account(e)&&a.fill.currency===e.fill.currency&&contract(a.fill)===contract(e.fill)&&(!e.brokerPositionId||a.brokerPositionId===e.brokerPositionId)&&a.fill.time<=e.fill.time));
  const options=[...new Set(eligible.map(a=>a.stage_key))].map(entryKey=>({entryKey,quantity:eligible.filter(a=>a.stage_key===entryKey).reduce((q,a)=>q+a.quantity,0)}));
  const saved=plan.management?.exit?.[exitKey]?.entryMatches,explicit=Array.isArray(saved);
  const matches=explicit?saved.map(m=>({...m})):options.length===1?[{entryKey:options[0].entryKey,quantity}]:[];
  const total=matches.reduce((q,m)=>q+Number(m.quantity||0),0),unique=new Set(matches.map(m=>m.entryKey));
  const valid=matches.length>0&&unique.size===matches.length&&matches.every(m=>typeof m.entryKey==='string'&&Number.isFinite(m.quantity)&&m.quantity>0&&options.some(o=>o.entryKey===m.entryKey))&&Math.abs(total-quantity)<=EPS;
  return {exitKey,quantity,options,matches,explicit,status:valid?'matched':'needs_match',reason:valid?null:'Choose entry rows and quantities for this exit'};
 });
}
function consume(queue,row,a){
 if(!row||row.status!=='matched')return null;
 const pieces=[];
 for(const match of row.matches){
  const wanted=Number(match.quantity)*a.quantity/row.quantity;
  const lots=queue.filter(l=>l.stageKey===match.entryKey&&l.q>EPS&&(!a.brokerPositionId||l.brokerPositionId===a.brokerPositionId)),available=lots.reduce((q,l)=>q+l.q,0);
  if(wanted>available+EPS)return null;
  let remaining=Math.min(wanted,available);
  for(const [i,lot]of lots.entries()){
   const q=i===lots.length-1?remaining:Math.min(remaining,wanted*lot.q/available);
   if(q>0){pieces.push({lot,q});remaining-=q;}
  }
 }
 if(Math.abs(pieces.reduce((q,p)=>q+p.q,0)-a.quantity)>EPS)return null;
 for(const p of pieces)p.lot.q-=p.q;
 for(let i=queue.length-1;i>=0;i--)if(queue[i].q<=EPS)queue.splice(i,1);
 return pieces;
}
function remember(plan,result){
 const management=JSON.parse(JSON.stringify(plan.management||{}));management.exit??={};
 for(const row of result.entryMatching||[])if(row.status==='matched'&&!row.explicit){management.exit[row.exitKey]={...management.exit[row.exitKey],entryMatches:row.matches};}
 return management;
}
module.exports={prepare,consume,remember};
