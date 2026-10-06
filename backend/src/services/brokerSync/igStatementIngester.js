const crypto=require('crypto');
const db=require('../../config/database');
const pdf=require('./igPdf'),daily=require('./igDailyStatement');
const {cents}=require('./igStatement');
const active=new Set();
const reasons={invalid_date:'The statement date could not be verified.',unknown_account:'The PDF does not match exactly one configured IG account.',
 unsupported_layout:'The statement layout is not supported.',unsupported_positions:'The complete positions table could not be reconciled.',
 new_share_execution_required:'A new share holding needs its execution statement and CSV history.',equity_conflict:'Reported equity does not equal cash plus holdings or running P&L.',
 cash_conflict:'The statement cash activity does not reconcile.',cash_date_conflict:'The PDF cash summary conflicts with transaction history on its reporting date. Its conflicting chart value is excluded; original statement evidence is retained for review.',unsupported_activity:'The PDF includes activity that needs updated CSV or execution reports.',
 conflicting_statement:'Different values are already stored for this account and date. Review the correction before applying it.',
 changed_accounts:'An account changed during processing. Retry after other imports finish.',import_failed:'The statement could not be reconciled with saved history. Updated reports or a review are needed.',
 fx_unavailable:'The dated GBP exchange rate is unavailable. Retry later.',maintenance:'Imported, but portfolio maintenance needs a retry.',
 activity_pending:'Portfolio valuation imported. Cash or trade history needs reconciliation with the missing statements or CSV reports.',
 resolved_by_later_history:'Resolved by subsequent statement and transaction history. Original PDF retained for audit; its conflicting chart value remains excluded.',
 backup_failed:'The required backup failed. No financial changes were applied. Check backup status before retrying.'};
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
async function saved(userId){return (await db.query(`SELECT a.account_identifier,a.account_name,s.payload,s.captured_at
 FROM user_accounts a JOIN broker_import_snapshots s ON s.user_id=a.user_id AND s.account_identifier=a.account_identifier AND s.broker_type='ig'
 WHERE a.user_id=$1 AND a.broker='ig' AND NOT a.is_archived ORDER BY a.account_identifier`,[userId])).rows;}
const revision=rows=>hash(Buffer.from(JSON.stringify(rows.map(r=>[r.account_identifier,r.payload]))));
function samePoint(stored,p){return stored&&Math.round(Number(stored.cash_usd)*Number(stored.gbp_per_usd)*100)===cents(p.cash)&&Math.round(Number(stored.holdings_usd)*Number(stored.gbp_per_usd)*100)===cents(p.holdings);}
async function checkPoint(client,userId,identifier,p){
 const old=(await client.query('SELECT cash_usd,holdings_usd,gbp_per_usd FROM portfolio_statement_values WHERE user_id=$1 AND account_identifier=$2 AND value_date=$3',[userId,identifier,p.date])).rows[0];
 if(old&&!samePoint(old,p))daily.fail('conflicting_statement');return old;
}
async function ingest(userId,buffer,{statementDate,filename,backup}={}){
 if(active.has(userId))return {status:'busy'};
 active.add(userId);const fingerprint=hash(buffer);let p,account;
 const ensureBackup=async()=>{try{await (backup?backup():require('../backup.service').createFullSiteBackup(userId));}catch{daily.fail('backup_failed');}};
 try{
  if(buffer.length>5*1024*1024)daily.fail('unsupported_layout');
  const prior=(await db.query('SELECT status,reason,processed_at FROM ig_statement_ingestion WHERE user_id=$1 AND attachment_hash=$2',[userId,fingerprint])).rows[0];
  if(prior&&['imported','duplicate'].includes(prior.status))return {status:'duplicate',hash:fingerprint,skipped:true};
  if(prior&&['review','rejected','conflict'].includes(prior.status)){
   if(!['backup_failed','fx_unavailable','changed_accounts'].includes(prior.reason)||Date.now()-Date.parse(prior.processed_at)<5*60000)
    return {status:prior.status,hash:fingerprint,reason:prior.reason,skipped:true};
  }
  await db.query(`INSERT INTO ig_statement_ingestion(user_id,attachment_hash,status) VALUES($1,$2,'processing')
    ON CONFLICT(user_id,attachment_hash) DO UPDATE SET status='processing',reason=NULL`,[userId,fingerprint]);
  const rows=await saved(userId),text=await pdf.text(buffer),id=daily.identity(text);
  const matches=rows.filter(r=>r.payload?.igFileInput?.statementMask===id.mask&&r.payload?.igFileInput?.statementLabel===id.label);
  if(matches.length!==1)daily.fail('unknown_account');account=matches[0];const base=account.payload.igFileInput;
  const named=daily.dateFromName(filename);if(statementDate&&named&&statementDate!==named)daily.fail('invalid_date');
  p=daily.parse(text,statementDate||named,base);
  if(base.kind==='share_dealing'&&p.date<=day(base.confirmation.cutoff)&&require('./igEmailReconciliation').cashAt(p,require('./igStatement').prepare(base).records)!==cents(p.cash))daily.fail('cash_date_conflict');
  await checkPoint(db,userId,account.account_identifier,p);
  const currentDay=day(base.confirmation.cutoff),isNew=p.date>=currentDay;
  const sameHoldings=base.kind==='share_dealing'
   ?p.positions.length===base.confirmation.holdings.length&&p.positions.every(h=>base.confirmation.holdings.some(old=>old.isin===h.isin&&old.quantity===h.quantity&&cents(old.cost)===cents(h.cost)))
   :p.positions.length===(base.confirmation.openBets||[]).length&&p.positions.every(h=>(base.confirmation.openBets||[]).some(old=>old.betId===h.betId&&old.quantity===h.quantity));
  let activityPending=isNew&&(!p.activitySupported||!sameHoldings);
  const evidence={...p};
  let inputs;
  if(isNew&&base.kind==='share_dealing'&&!activityPending){
   const records=new Map((base.emailCashRecords||[]).map(r=>[r.reference,r]));
   for(const r of p.records){const old=records.get(r.reference);if(old&&require('./igEmailCash').signature(old)!==require('./igEmailCash').signature(r))daily.fail('cash_conflict');records.set(r.reference,r);}
   const cutoff=new Date(require('../../utils/timezone').localToUTC(p.date+'T23:59:59','Europe/London')).toISOString();
   const updated={...base,emailCashRecords:[...records.values()],confirmation:{...base.confirmation,cash:p.cash,cutoff,holdings:p.positions},
    statementValues:[...(base.statementValues||[]).filter(v=>v.date!==p.date),{date:p.date,cash:p.cash,holdings:p.holdings}]};
   inputs=rows.map(r=>r===account?updated:r.payload.igFileInput);
   try{await require('./igImport').importAccounts(userId,inputs,{dryRun:true});}catch{activityPending=true;}
  }
  if(inputs&&!activityPending){
   const imports=require('./igImport');
   await ensureBackup();
   await imports.importAccounts(userId,inputs,{dryRun:false,beforeImport:async client=>{
    if(revision(await saved(userId))!==revision(rows))daily.fail('changed_accounts');
    await checkPoint(client,userId,account.account_identifier,p);
   },beforeCommit:client=>client.query(`UPDATE ig_statement_ingestion SET status='imported',statement_date=$3,account_identifier=$4,evidence=$5::jsonb,processed_at=NOW()
     WHERE user_id=$1 AND attachment_hash=$2`,[userId,fingerprint,p.date,account.account_identifier,JSON.stringify(evidence)])});
  }else{
   // A dated valuation is independent of journal reconstruction. No invented
   // trade, income or cash movement is posted from a spread-bet notional.
   if(isNew&&base.kind==='spread_bet'&&cents(p.cash)!==cents(base.confirmation.cash))activityPending=true;
   const fx=(await require('../../utils/currencyConverter').getRateMap('USD',p.date)).GBP;
   if(!(fx>0))daily.fail('fx_unavailable');
   await ensureBackup();
   await db.withTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ig-file:${userId}`]);
    await checkPoint(client,userId,account.account_identifier,p);
    await require('./igNavHistory').savePoint(client,userId,account.account_identifier,p,fx);
    if(isNew&&sameHoldings){
     const prior=(await client.query("SELECT positions FROM broker_portfolio_snapshots WHERE user_id=$1 AND broker_type='ig' AND account_identifier=$2 FOR UPDATE",[userId,account.account_identifier])).rows[0];
     const native=p.positions.map(h=>{
      const old=prior?.positions.find(pos=>base.kind==='share_dealing'?pos.symbol===h.symbol:pos.betId===h.betId);
      if(!old)daily.fail('unsupported_positions');
      return {...old,currentValue:(base.kind==='share_dealing'?h.value:h.notional)/fx,
       ...(base.kind==='spread_bet'?{unrealizedPnL:h.unrealizedPnL/fx}:{}),asOf:p.asOf};
     });
     await client.query(`UPDATE broker_portfolio_snapshots SET positions=$3::jsonb,synced_at=$4
      WHERE user_id=$1 AND broker_type='ig' AND account_identifier=$2 AND synced_at<=$4`,[userId,account.account_identifier,JSON.stringify(native),p.asOf]);
    }
    await client.query(`UPDATE ig_statement_ingestion SET status='imported',statement_date=$3,account_identifier=$4,evidence=$5::jsonb,reason=$6,processed_at=NOW()
     WHERE user_id=$1 AND attachment_hash=$2`,[userId,fingerprint,p.date,account.account_identifier,JSON.stringify(evidence),activityPending?'activity_pending':null]);
   });
  }
  const maintenance=await require('../manualPortfolioMaintenance').rebuild(userId,'ig',[account.account_identifier],p.date);
  if(maintenance.failed&&!activityPending)await db.query("UPDATE ig_statement_ingestion SET reason='maintenance' WHERE user_id=$1 AND attachment_hash=$2",[userId,fingerprint]);
  return {status:'imported',hash:fingerprint,date:p.date,activityPending,maintenance};
 }catch(e){
  // Import commit can succeed even if derived cache invalidation fails.
  // Preserve its durable receipt so retries cannot repeat financial postings.
  const committed=(await db.query("SELECT status FROM ig_statement_ingestion WHERE user_id=$1 AND attachment_hash=$2",[userId,fingerprint])).rows[0];
  if(committed?.status==='imported'){
   await db.query("UPDATE ig_statement_ingestion SET reason='maintenance' WHERE user_id=$1 AND attachment_hash=$2",[userId,fingerprint]);
   return {status:'imported',hash:fingerprint,reason:'maintenance'};
  }
  const reason=reasons[e.igReason]?e.igReason:'import_failed',status=reason==='conflicting_statement'?'conflict':['unknown_account','invalid_date','unsupported_layout'].includes(reason)?'rejected':'review';
  await db.query(`INSERT INTO ig_statement_ingestion(user_id,attachment_hash,status,reason,statement_date,account_identifier,evidence,processed_at)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW()) ON CONFLICT(user_id,attachment_hash) DO UPDATE SET
   status=EXCLUDED.status,reason=EXCLUDED.reason,statement_date=EXCLUDED.statement_date,account_identifier=EXCLUDED.account_identifier,evidence=EXCLUDED.evidence,processed_at=NOW()`,
   [userId,fingerprint,status,reason,p?.date||null,account?.account_identifier||null,p?JSON.stringify(p):null]);
  return {status,hash:fingerprint,reason};
 }finally{active.delete(userId);}
}
async function status(userId){
 const rows=(await db.query(`SELECT i.id,i.statement_date,i.status,i.reason,i.processed_at,a.account_name FROM ig_statement_ingestion i
 LEFT JOIN user_accounts a ON a.user_id=i.user_id AND a.account_identifier=i.account_identifier WHERE i.user_id=$1 ORDER BY i.received_at DESC LIMIT 100`,[userId])).rows;
 return {enabled:process.env.ENABLE_IG_STATEMENT_INGESTER==='true'&&process.env.IG_INGEST_USER_ID===userId,
  running:active.has(userId),documents:rows.map(r=>({...r,needsReview:['review','conflict','rejected'].includes(r.status)||['activity_pending','cash_date_conflict'].includes(r.reason),reason:reasons[r.reason]||null}))};
}
module.exports={ingest,status,samePoint,reasons};
