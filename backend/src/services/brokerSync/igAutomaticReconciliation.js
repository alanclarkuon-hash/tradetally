const db=require('../../config/database'),crypto=require('crypto');
const running=new Set();
const revision=rows=>crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>[r.account_identifier,r.payload]))).digest('hex');
async function saved(userId){return (await db.query("SELECT account_identifier,payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='ig' ORDER BY account_identifier",[userId])).rows;}
async function run(userId,{backup}={}){
 if(running.has(userId))return {busy:true};
 running.add(userId);
 try{
  const pending=(await db.query("SELECT account_identifier,statement_date::text,reason FROM ig_statement_ingestion WHERE user_id=$1 AND ((status='imported' AND reason IN ('activity_pending','cash_date_conflict','maintenance')) OR (status='review' AND reason='cash_date_conflict') OR (status='conflict' AND reason='conflicting_statement'))",[userId])).rows;
  if(!pending.length)return {reconciled:false};
  const rows=await saved(userId),inputs=rows.map(r=>r.payload.igFileInput),selected=[];
  for(let i=0;i<rows.length;i++){
   const input=inputs[i];
   if(input.kind!=='share_dealing'||!pending.some(p=>p.account_identifier===rows[i].account_identifier&&p.reason!=='maintenance'))continue;
   try{
    const updated=await require('./igCsvReconciliation').reconcile(userId,input,input.transactions);
    if(pending.filter(p=>p.account_identifier===rows[i].account_identifier).every(p=>p.reason==='conflicting_statement')){
     const evidence=(await db.query("SELECT status,reason,evidence FROM ig_statement_ingestion WHERE user_id=$1 AND account_identifier=$2 AND status IN ('imported','conflict')",[userId,rows[i].account_identifier])).rows;
     const records=require('./igStatement').prepare(updated).records;
     if(!evidence.some(r=>r.status==='conflict'&&r.reason==='conflicting_statement'&&require('./igEmailReconciliation').conflictResolution(r.evidence,evidence,records,updated.confirmation.cutoff)))continue;
    }
    inputs[i]=updated;selected.push(rows[i].account_identifier);
   }
   catch(e){if(!e.message?.startsWith('IG upload:')&&!e.message?.startsWith('IG statement:'))throw e;}
  }
  let corrections=[];
  if(selected.length){
   const importer=require('./igImport');
   await importer.importAccounts(userId,inputs,{dryRun:true});
   await (backup?backup():require('../backup.service').createFullSiteBackup(userId));
   const result=await importer.importAccounts(userId,inputs,{dryRun:false,beforeImport:async()=>{
    if(revision(await saved(userId))!==revision(rows))throw Error('IG account changed during automatic reconciliation');
   }});
   corrections=result?.reconciledStatementAccounts||[];
  }
  const affected=[...new Set([...selected,...corrections.map(c=>c.identifier),...pending.filter(p=>p.reason==='maintenance').map(p=>p.account_identifier)])];
  let failed=false;
  for(const identifier of affected){
   const dates=[...pending.filter(p=>p.account_identifier===identifier).map(p=>p.statement_date),...corrections.filter(c=>c.identifier===identifier).flatMap(c=>c.dates)].sort();
   const result=await require('../manualPortfolioMaintenance').rebuild(userId,'ig',[identifier],dates[0]);
   if(result.failed){
    failed=true;
    await db.query("UPDATE ig_statement_ingestion SET reason='maintenance' WHERE user_id=$1 AND account_identifier=$2 AND status='imported' AND reason IS NULL AND statement_date=(SELECT MAX(statement_date) FROM ig_statement_ingestion WHERE user_id=$1 AND account_identifier=$2 AND status='imported')",[userId,identifier]);
    continue;
   }
   await db.query("UPDATE ig_statement_ingestion SET reason=NULL WHERE user_id=$1 AND account_identifier=$2 AND status='imported' AND reason='maintenance'",[userId,identifier]);
  }
  return {reconciled:!!selected.length,maintenanceFailed:failed};
 }finally{running.delete(userId);}
}
module.exports={run};
