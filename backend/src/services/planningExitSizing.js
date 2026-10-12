const {accountIds,stageAccount}=require('./planningAccounts');
const {floorQuantity,fail}=require('./tradePlanning');
const EPS=1e-8;
function position(result,id) {
 const own=(result.records||[]).filter(r=>r.accountId===id&&r.valid);
 return {entered:own.filter(r=>r.action==='entry'&&!r.stage_key.startsWith('roll_')).reduce((v,r)=>v+r.quantity,0),exited:own.filter(r=>r.action==='exit').reduce((v,r)=>v+r.quantity,0),own};
}
function state(plan,result) {
 if(plan.definition.instrument==='option')return {accounts:[],pending:false};
 const accounts=accountIds(plan.definition).map(id=>{
  const p=position(result,id),confirmed=plan.exit_sizing?.[id],basis=confirmed?.entered??p.entered;
  const step=(id===plan.definition.accountId?plan.definition.constraints?.quantityStep:plan.definition.accountConstraints?.[id]?.quantityStep)||plan.definition.quantityStep;
  const rows=plan.definition.exits.filter(e=>stageAccount(plan.definition,'exit',e.key)===id).map(e=>{
   const done=p.own.filter(r=>r.action==='exit'&&r.stage_key===e.key),m=plan.management?.exit?.[e.key]||{};
   const completed=done.length>0||m.executed===true;
   const quantity=completed?done.length?done.reduce((v,r)=>v+r.quantity,0):m.units:m.units??e.units??floorQuantity(basis*(m.percent??e.percent)/100,step);
   return {key:e.key,label:e.label,completed,quantity,suggested:completed?quantity:floorQuantity(p.entered*(m.percent??e.percent)/100,step)};
  });
  return {accountId:id,entered:p.entered,exited:p.exited,open:Math.max(0,p.entered-p.exited),basis,confirmedAt:confirmed?.confirmedAt||null,rows,pending:p.entered>0&&Math.abs(p.entered-basis)>EPS};
 });
 return {accounts,pending:accounts.some(a=>a.pending),needsReconciliation:!!result.unresolved||!!result.overExit};
}
function initialise(plan,before,after) {
 if(plan.definition.instrument==='option')return plan.exit_sizing||{};
 const next={...(plan.exit_sizing||{})};
 for(const id of accountIds(plan.definition)) {
  const previous=position(before,id),current=position(after,id);
  if(current.entered<=EPS){if(!(after.records||[]).some(r=>r.action==='entry'&&r.accountId===id))delete next[id];continue}
  if((previous.entered<=EPS&&!(before.records||[]).some(r=>r.action==='entry'&&r.accountId===id))||!next[id])next[id]={entered:previous.entered>EPS?previous.entered:current.entered,confirmedAt:new Date().toISOString(),source:'initial_filled_quantity'};
 }
 return next;
}
function confirm(plan,result,input) {
 const status=state(plan,result),account=status.accounts.find(a=>a.accountId===input.accountId);
 if(!account||!(account.entered>0))fail('Choose an account with entered quantity');
 if(status.needsReconciliation)fail('Reconcile changed entries or over-exits before revising exit quantities');
 if(Math.abs(input.entered-account.entered)>EPS)fail('Entered quantity changed. Reload the exit recheck',409);
 const expected=account.rows.filter(r=>!r.completed),chosen=input.rows;
 if(new Set(chosen.map(r=>r.key)).size!==chosen.length||chosen.length!==expected.length||chosen.some(r=>!expected.some(e=>e.key===r.key)))fail('Confirm every remaining row in this account; completed exits cannot be changed');
 const total=chosen.reduce((v,r)=>v+r.units,0);if(total>account.open+EPS)fail('Remaining exit quantities exceed the open position');
 const management=JSON.parse(JSON.stringify(plan.management||{}));management.exit??={};
 for(const row of chosen){const definition=plan.definition.exits.find(e=>e.key===row.key),old=management.exit[row.key]||{};management.exit[row.key]={executed:false,price:definition.price,time:new Date().toISOString(),tactics:definition.tactics||[],marketContext:definition.marketContext||[],percent:definition.percent,premium:definition.premium??null,...old,units:row.units};}
 const sizing={...(plan.exit_sizing||{}),[input.accountId]:{entered:account.entered,confirmedAt:new Date().toISOString(),source:'user_confirmed'}};
 return {management,sizing,previous:account,rows:chosen,unassigned:Math.max(0,account.open-total),reason:input.reason};
}
module.exports={state,initialise,confirm};
