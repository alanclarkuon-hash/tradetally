const db=require('../../config/database'),{signature}=require('./igEmailCash'),{fail}=require('./igDailyStatement');
const revision=rows=>JSON.stringify(rows.map(r=>[r.account_identifier,r.payload]));
async function ingest(userId,buffer,text,rows,{fingerprint,backup}){
 const ledger=await require('./igLedgerStatement').read(buffer,text);
 const matches=rows.filter(r=>r.payload?.igFileInput?.ledgerAccountId===ledger.account);
 if(matches.length!==1)fail('unknown_account');const account=matches[0],base=account.payload.igFileInput;
 if(base.kind!=='share_dealing')fail('ledger_unsupported_activity');
 const events=new Map((base.emailCashRecords||[]).map(e=>[e.reference,e]));
 for(const e of ledger.records){const old=events.get(e.reference);if(old&&signature(old)!==signature(e))fail('cash_conflict');if(!old)events.set(e.reference,e);}
 let updated;
 try{updated=await require('./igCsvReconciliation').reconcile(userId,{...base,emailCashRecords:[...events.values()]},base.transactions);}
 catch(e){if(e.message?.includes('Transactions do not reconcile'))fail('ledger_cash_incomplete');throw e;}
 const inputs=rows.map(r=>r===account?updated:r.payload.igFileInput),imports=require('./igImport');
 await imports.importAccounts(userId,inputs,{dryRun:true});await backup();
 const result=await imports.importAccounts(userId,inputs,{dryRun:false,beforeImport:async client=>{
  const fresh=(await client.query("SELECT a.account_identifier,s.payload FROM user_accounts a JOIN broker_import_snapshots s ON s.user_id=a.user_id AND s.account_identifier=a.account_identifier AND s.broker_type='ig' WHERE a.user_id=$1 AND a.broker='ig' AND NOT a.is_archived ORDER BY a.account_identifier",[userId])).rows;
  if(revision(fresh)!==revision(rows))fail('changed_accounts');
 },beforeCommit:client=>client.query(`UPDATE ig_statement_ingestion SET status='imported',reason=NULL,statement_date=$3,account_identifier=$4,evidence=$5::jsonb,processed_at=NOW() WHERE user_id=$1 AND attachment_hash=$2`,[userId,fingerprint,ledger.to,account.account_identifier,JSON.stringify(ledger)])});
 const maintenance=await require('../manualPortfolioMaintenance').rebuild(userId,'ig',[account.account_identifier],ledger.from);
 if(maintenance.failed)await db.query("UPDATE ig_statement_ingestion SET reason='maintenance' WHERE user_id=$1 AND attachment_hash=$2",[userId,fingerprint]);
 return {status:'imported',hash:fingerprint,date:ledger.to,reportType:'ledger',importedEvents:result.importedEvents,maintenance};
}
module.exports={ingest};
