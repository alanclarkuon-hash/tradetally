// Confirmed statement balances do not imply a complete transaction ledger.
const db=require('../../config/database'),{prepare,cents}=require('./igStatement');
const {signature}=require('./igEmailCash');
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const sameHoldings=(a,b)=>a.length===b.length&&a.every(p=>b.some(h=>h.isin===p.isin&&h.quantity===p.quantity&&cents(h.cost)===cents(p.cost)));
function analyse(base,receipts){
 if(base.kind!=='share_dealing')return null;
 const original=prepare(base),events=new Map((base.emailCashRecords||[]).map(r=>[r.reference,r]));
 const selected=receipts.filter(r=>['activity_pending','unitemised_cash'].includes(r.reason)&&r.status==='imported'&&r.evidence?.date>base.confirmation.cutoff.slice(0,10));
 if(!selected.length)return null;
 for(const row of selected){const p=row.evidence;
  if(!p.activitySupported||!Array.isArray(p.records)||p.openingCash==null||!Array.isArray(p.positions)||!sameHoldings(p.positions,base.confirmation.holdings))return null;
  let balance=cents(p.openingCash);
  for(const e of p.records){
   if(!e.reference?.startsWith('email:')||e.source!=='ig_email'||!['interest','dividend','tax','account_fee','deposit','withdrawal','transfer_in','transfer_out'].includes(e.type)||!Number.isFinite(Date.parse(e.time))||e.time>new Date(require('../../utils/timezone').localToUTC(p.date+'T23:59:59','Europe/London')).toISOString())return null;
   if(cents(e.amount)!==cents(e.cash))return null;
   balance+=cents(e.cash);if(balance!==cents(e.reportedBalance))return null;
   const prior=events.get(e.reference);if(prior&&signature(prior)!==signature(e))throw Error('Conflicting IG email cash evidence');events.set(e.reference,e);
  }
  if(balance!==cents(p.cash))return null;
 }
 const updated={...base,emailCashRecords:[...events.values()]};
 const prepared=prepare(updated); // Original verified cutoff must still reconcile.
 const coverage=selected.map(row=>{const calculated=require('./igEmailReconciliation').cashAt(row.evidence,prepared.records)/100;
  return {receipt:row,date:row.evidence.date,reported:row.evidence.cash,calculated,difference:(cents(row.evidence.cash)-cents(calculated))/100};});
 return {original,updated,prepared,coverage};
}
async function apply(userId,identifier,{backup}={}){
 const snapshot=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND account_identifier=$2 AND broker_type='ig'",[userId,identifier])).rows[0];if(!snapshot)return {changed:false};
 const receipts=(await db.query("SELECT id,status,reason,evidence FROM ig_statement_ingestion WHERE user_id=$1 AND account_identifier=$2 AND status='imported' ORDER BY statement_date,id",[userId,identifier])).rows;
 const plan=analyse(snapshot.payload.igFileInput,receipts);if(!plan)return {changed:false};
 const existing=(await db.query('SELECT * FROM ig_statement_cash_coverage WHERE user_id=$1 AND account_identifier=$2',[userId,identifier])).rows;
 const changed=JSON.stringify(plan.updated.emailCashRecords)!==JSON.stringify(snapshot.payload.igFileInput.emailCashRecords||[])||plan.coverage.some(c=>{const r=existing.find(r=>r.receipt_id===c.receipt.id);return !r||Number(r.reported_cash)!==c.reported||Number(r.calculated_cash)!==c.calculated||c.receipt.reason!==(c.difference!==0?'unitemised_cash':null);});
 if(!changed)return {changed:false,partial:true};
 const rates=new Map();for(const e of plan.prepared.records){if(e.reference.startsWith('email:')&&!rates.has(e.date)){const fx=Number((await require('../../utils/currencyConverter').getRateMap('USD',e.date)).GBP);if(!(fx>0))throw Error('Dated GBP conversion unavailable');rates.set(e.date,1/fx);}}
 await (backup?backup():require('../backup.service').createFullSiteBackup(userId));
 await db.withTransaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ig-file:${userId}`]);
  const current=(await client.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND account_identifier=$2 AND broker_type='ig' FOR UPDATE",[userId,identifier])).rows[0];
  if(JSON.stringify(current?.payload)!==JSON.stringify(snapshot.payload))throw Error('IG account changed during email cash update');
  const fresh=(await client.query("SELECT id,status,reason,evidence FROM ig_statement_ingestion WHERE user_id=$1 AND account_identifier=$2 AND status='imported' ORDER BY statement_date,id FOR UPDATE",[userId,identifier])).rows;
  if(JSON.stringify(fresh)!==JSON.stringify(receipts))throw Error('IG statement evidence changed during email cash update');
  const account=(await client.query("SELECT id FROM user_accounts WHERE user_id=$1 AND account_identifier=$2 AND broker='ig' AND currency='GBP' AND NOT is_archived FOR UPDATE",[userId,identifier])).rows;
  if(account.length!==1)throw Error('Ambiguous IG account');
  for(const e of plan.prepared.records.filter(r=>r.reference.startsWith('email:'))){
   const old=(await client.query("SELECT amount,event_type,event_date,metadata FROM broker_cash_events WHERE user_id=$1 AND account_id=$2 AND broker_type='ig' AND reference_id=$3 FOR UPDATE",[userId,account[0].id,e.reference])).rows[0];
   if(old&&(cents(old.amount)!==cents(e.amount)||old.event_type!==e.type||day(old.event_date)!==e.date||old.metadata?.time!==e.time))throw Error('Existing IG cash event changed');
   await client.query(`INSERT INTO broker_cash_events(user_id,account_id,broker_type,reference_id,event_type,event_date,amount,currency,amount_usd,description,metadata)
    VALUES($1,$2,'ig',$3,$4,$5,$6,'GBP',$7,$8,$9::jsonb) ON CONFLICT(user_id,account_id,broker_type,reference_id) DO NOTHING`,[userId,account[0].id,e.reference,e.type,e.date,e.amount,e.amount*rates.get(e.date),e.description,JSON.stringify({source:'ig_file',time:e.time,internalTransfer:e.type.startsWith('transfer_'),itemisedStatement:true})]);
  }
  await client.query("UPDATE broker_import_snapshots SET payload=jsonb_set(payload,'{igFileInput,emailCashRecords}',$3::jsonb),captured_at=NOW() WHERE user_id=$1 AND account_identifier=$2 AND broker_type='ig'",[userId,identifier,JSON.stringify(plan.updated.emailCashRecords)]);
  for(const c of plan.coverage){
   await client.query(`INSERT INTO ig_statement_cash_coverage(receipt_id,user_id,account_identifier,statement_date,currency,reported_cash,calculated_cash,unitemised_cash,verified_through)
    VALUES($1,$2,$3,$4,'GBP',$5,$6,$7,$8) ON CONFLICT(receipt_id) DO UPDATE SET reported_cash=EXCLUDED.reported_cash,calculated_cash=EXCLUDED.calculated_cash,unitemised_cash=EXCLUDED.unitemised_cash,verified_through=EXCLUDED.verified_through`,[c.receipt.id,userId,identifier,c.date,c.reported,c.calculated,c.difference,plan.updated.confirmation.cutoff]);
   await client.query("UPDATE ig_statement_ingestion SET reason=$3 WHERE id=$1 AND user_id=$2",[c.receipt.id,userId,c.difference!==0?'unitemised_cash':null]);
  }
  await client.query('DELETE FROM analytics_cache WHERE user_id=$1',[userId]);
 });
 await require('../analyticsCache').invalidate(userId);
 return {changed:true,partial:true};
}
module.exports={analyse,apply};
