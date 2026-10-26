const {isDeepStrictEqual}=require('util');
const {sourceFills}=require('../planningLedger');
const EPS=1e-8;
const meta=t=>t.executions?.[0]||{};
const key=t=>meta(t).okx_record_key;
function sameAcquisition(a,b){const x=meta(a),y=meta(b);return a.account_identifier===b.account_identifier&&a.symbol===b.symbol&&String(x.okx_origin_connection_id||a.broker_connection_id)===String(y.okx_origin_connection_id||b.broker_connection_id)&&x.okx_entry?.billId!=null&&isDeepStrictEqual(x.okx_entry,y.okx_entry)}
function reuseAnchors(existing,mapped,connection){
 const old=new Map(existing.map(t=>[key(t),t])),reserved=new Set(old.keys());
 for(const t of existing.filter(t=>key(t)?.endsWith(':open')&&!mapped.some(n=>n.key===key(t)))){
  const replacement=mapped.find(n=>!reserved.has(n.key)&&n.entry?.billId===meta(t).okx_entry?.billId&&(n.origin||connection.id)===(meta(t).okx_origin_connection_id||connection.id)&&n.symbol===t.symbol);
  if(replacement){old.delete(key(t));old.set(replacement.key,t);reserved.add(replacement.key);}
 }
 return old;
}
function rebase(existing,current,allocations){
 const oldKeys=new Set(existing.map(key)),changes=[];
 for(const before of existing.filter(t=>key(t)?.endsWith(':open'))){
  const links=allocations.filter(a=>a.trade_id===before.id);if(!links.length)continue;
  const oldFill=sourceFills(before).find(f=>f.action==='entry');
  if(!oldFill||links.some(a=>a.action!=='entry'||a.source_key!==oldFill.key||a.source_snapshot.fingerprint!==oldFill.fingerprint))throw Error('OKX linked source evidence needs reconciliation before syncing');
  const successors=current.filter(t=>sameAcquisition(before,t)&&(key(t)?.endsWith(':open')||!oldKeys.has(key(t)))).sort((a,b)=>(a.id===before.id?-1:b.id===before.id?1:String(key(a)).localeCompare(String(key(b))))).map(t=>({trade:t,fill:sourceFills(t).find(f=>f.action==='entry'),available:Number(t.quantity)}));
  if(!successors.length)throw Error('A linked OKX acquisition moved outside this account. Review its plan account before syncing.');
  for(const s of successors){const f=s.fill;if(!f||f.currency!==oldFill.currency||f.time!==oldFill.time||f.multiplier!==oldFill.multiplier||Math.abs(f.price-oldFill.price)>EPS||f.costs!==oldFill.costs||!isDeepStrictEqual(f.transactionFx,oldFill.transactionFx))throw Error('OKX linked acquisition cost or FX changed; reconcile the plan source first');}
  if(links.reduce((v,a)=>v+Number(a.quantity),0)>successors.reduce((v,s)=>v+s.available,0)+EPS)throw Error('OKX linked quantities exceed the verified replacement acquisition');
  for(const a of links){let remaining=Number(a.quantity),pieces=[];
   for(const s of successors){if(!(remaining>0)||!(s.available>0))continue;const q=remaining<=s.available+EPS?remaining:s.available;pieces.push({tradeId:s.trade.id,sourceKey:s.fill.key,snapshot:s.fill,quantity:q});remaining-=q;s.available=Math.max(0,s.available-q);}
   if(remaining>EPS)throw Error('OKX linked quantities could not be preserved');
   if(remaining>0&&pieces.length)pieces[pieces.length-1].quantity+=remaining;
   if(pieces.length===1&&pieces[0].tradeId===a.trade_id&&pieces[0].sourceKey===a.source_key&&pieces[0].snapshot.fingerprint===a.source_snapshot.fingerprint)continue;
   changes.push({allocation:a,pieces});
  }
 }
 return changes;
}
async function save(client,userId,changes){
 const plans=new Set();
 for(const {allocation:a,pieces} of changes){
  for(const [i,p] of pieces.entries()){
   if(i===0)await client.query('UPDATE trade_plan_allocations SET trade_id=$1,source_key=$2,source_snapshot=$3::jsonb,quantity=$4 WHERE id=$5 AND user_id=$6 AND plan_id=$7',[p.tradeId,p.sourceKey,JSON.stringify(p.snapshot),p.quantity,a.id,userId,a.plan_id]);
   else await client.query('INSERT INTO trade_plan_allocations(user_id,plan_id,trade_id,source_key,stage_key,action,quantity,source_snapshot,journal_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)',[userId,a.plan_id,p.tradeId,p.sourceKey,a.stage_key,a.action,p.quantity,JSON.stringify(p.snapshot),JSON.stringify(a.journal_evidence||null)]);
  }
  await client.query("INSERT INTO trade_plan_events(plan_id,user_id,event_type,snapshot) VALUES($1,$2,'trade_source_reconciled',$3::jsonb)",[a.plan_id,userId,JSON.stringify({reason:'OKX acquisition repartitioned after broker activity',previousAllocation:a,replacements:pieces})]);plans.add(a.plan_id);
 }
 for(const id of plans)await client.query('UPDATE trade_plans SET version=version+1,updated_at=NOW() WHERE id=$1 AND user_id=$2',[id,userId]);
}
module.exports={reuseAnchors,rebase,save};
