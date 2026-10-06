const db=require('../config/database');
const pending=new Map();
const supported=new Set(['ibkr','trading212','kraken','okx','etoro','ig']);
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);

async function maintain(userId,{broker=null,fetchPrices=true,fullHistory=false}={}) {
 // Serialize recovery for each user, including scheduler/manual overlap.
 const key=userId,prior=pending.get(key)||Promise.resolve();
 const job=(async()=>{
  await prior.catch(()=>{});
  const accounts=(await db.query("SELECT * FROM user_accounts WHERE user_id=$1 AND NOT is_archived AND account_identifier IS NOT NULL",[userId])).rows
   .filter(a=>supported.has(a.broker)&&(!broker||a.broker===broker));
  const warnings=[],rebuilt=[];
  if(!accounts.length)return {captured:0,rebuilt,warnings};
  for(const account of accounts) {
   if(account.broker==='ibkr') {
     // Dated NAV remains authoritative. Only closed-market weekend days can
     // use the documented prior-close estimate, with ledger cash movements.
     try {await require('./brokerSync/ibkrNavHistory').backfillTrailingWeekends(userId,account);}
     catch {warnings.push('ibkr: weekend portfolio history could not be updated; dated NAV values were retained.');}
     continue;
   }
   try {
    if(account.broker==='kraken') {
      const snapshot=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='kraken' AND account_identifier=$2",[userId,account.account_identifier])).rows[0];
      if(!snapshot?.payload?.reconciled||!snapshot.payload.nativeReconciliation?.nativeBalancesMatched) {
        warnings.push('kraken: portfolio history awaits native balance reconciliation.');continue;
      }
    }
    if(account.broker==='okx') {
      const snapshot=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='okx' AND account_identifier=$2",[userId,account.account_identifier])).rows[0];
      if(!snapshot?.payload?.historyComplete||snapshot.payload.funding?.length||snapshot.payload.positions?.length){warnings.push('okx: portfolio history awaits spot balance reconciliation.');continue;}
    }
    const coverage=(await db.query(`SELECT MAX(value_date) AS latest,
      MIN(value_date) FILTER (WHERE holdings_usd IS NULL OR issues <> '[]'::jsonb) AS first_gap
      FROM portfolio_reconstructed_values WHERE user_id=$1 AND account_identifier=$2 AND value_date<CURRENT_DATE`,[userId,account.account_identifier])).rows[0];
    const last=coverage?.latest;
    const fromDate=fullHistory&&account.initial_balance_date?day(account.initial_balance_date):coverage?.first_gap?day(coverage.first_gap):last?day(new Date(Date.parse(day(last))-2*86400000)):day(account.initial_balance_date);
    const summary=await require('./portfolioReconstructionService').reconstruct(userId,{broker:account.broker,
     accountIdentifiers:[account.account_identifier],fromDate,fetchPrices,apply:true,zeroMissingPrices:true});
    rebuilt.push(...summary.map(s=>({broker:s.broker,days:s.days,gaps:s.gaps})));
    if(summary.some(s=>s.gaps))warnings.push(`${account.broker}: some historical portfolio dates remain unavailable; review chart coverage.`);
   } catch {warnings.push(`${account.broker}: portfolio history backfill could not finish; imported broker records were retained.`);}
  }
  const capture=await require('./portfolioValueHistoryService').captureToday(userId,{accounts:accounts.map(a=>a.account_identifier).join(',')});
  warnings.push(...(capture.warnings||[]));
  return {captured:capture.captured,rebuilt,warnings};
 })();
 pending.set(key,job);
 try{return await job;}finally{if(pending.get(key)===job)pending.delete(key);}
}
async function maintainAllUsers() {
 for(const user of (await db.query('SELECT id FROM users')).rows)await require('./historyBackfillService').enqueue(user.id);
}
module.exports={maintain,maintainAllUsers};
