const crypto=require('crypto');
// Matching a fill consumes capacity once. Unlinking a journal association does
// not undo an external execution or imply the broker order is live again.
function reconcile(commitment,allocations){
 const snapshot=JSON.parse(JSON.stringify(commitment.snapshot||{}));
 const previous=snapshot.reservation;
 const originalQuantity=Number(previous?.originalQuantity??snapshot.stage?.quantity);
 const originalRisk=Number(previous?.originalRisk??commitment.risk_amount);
 if(!(originalQuantity>0)||!(originalRisk>0))return null;
 const matchedFills={...(previous?.matchedFills||{})};
 for(const a of allocations){
  const identity=a.source_key?.startsWith('id:broker:')?a.source_key:a.trade_id+'|'+a.source_key;
  const key=crypto.createHash('sha256').update(identity).digest('hex');
  matchedFills[key]=Math.max(Number(matchedFills[key]||0),Number(a.quantity)||0);
 }
 const filledQuantity=Object.values(matchedFills).reduce((sum,q)=>sum+q,0);
 let remainingQuantity=Math.max(0,originalQuantity-filledQuantity);
 if(remainingQuantity<=1e-8)remainingQuantity=0;
 const remainingFraction=remainingQuantity/originalQuantity;
 snapshot.reservation={originalQuantity,originalRisk,filledQuantity,remainingQuantity,remainingFraction,matchedFills};
 return {snapshot,remainingQuantity,remainingRisk:remainingQuantity?Math.max(1e-8,originalRisk*remainingFraction):0,status:remainingQuantity?'reserved':'released'};
}
function remainingFraction(snapshot){return snapshot?.reservation?.remainingFraction??1}
function remainingQuantity(snapshot){return snapshot?.reservation?.remainingQuantity??snapshot?.stage?.quantity??null}
async function reconcileRow(client,p,key){
 const commitments=(await client.query("SELECT * FROM trade_plan_commitments WHERE plan_id=$1 AND user_id=$2 AND stage_key=$3 AND status='reserved' FOR UPDATE",[p.id,p.user_id,key])).rows;
 if(!commitments.length)return;
 const allocations=(await client.query("SELECT trade_id,source_key,quantity FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2 AND stage_key=$3 AND action='entry'",[p.id,p.user_id,key])).rows;
 for(const c of commitments){
  const next=reconcile(c,allocations);if(!next)continue;
  await client.query("UPDATE trade_plan_commitments SET snapshot=$1::jsonb,risk_amount=$2,status=$3,released_at=CASE WHEN $3='released' THEN NOW() ELSE NULL END,release_reason=CASE WHEN $3='released' THEN 'Fully replaced by linked entry fills' ELSE NULL END WHERE id=$4",[JSON.stringify(next.snapshot),next.remainingRisk||Number(c.risk_amount),next.status,c.id]);
  await client.query('INSERT INTO trade_plan_events(plan_id,user_id,event_type,snapshot) VALUES($1,$2,$3,$4::jsonb)',[p.id,p.user_id,'commitment_fill_reconciled',JSON.stringify({commitmentId:c.id,stageKey:key,currency:c.currency,remainingQuantity:next.remainingQuantity,remainingRisk:next.remainingRisk,status:next.status})]);
 }
}
async function requireResolved(client,p){if((await client.query("SELECT id FROM trade_plan_commitments WHERE plan_id=$1 AND user_id=$2 AND status='reserved' LIMIT 1",[p.id,p.user_id])).rows.length)require('./tradePlanning').fail('Fill or confirm cancellation of outstanding entry orders before completing review or closing the plan',409)}
module.exports={reconcile,remainingFraction,remainingQuantity,reconcileRow,requireResolved};
