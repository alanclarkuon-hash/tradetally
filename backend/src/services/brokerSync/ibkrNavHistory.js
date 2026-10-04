const db=require('../../config/database');
const {loadLedger}=require('./ibkrCashLedger');
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
function reportDate(v) {
 const s=String(v||''),d=/^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`:s;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('Invalid IBKR NAV date');
 return d;
}
const components=['cash','stock','options','commodities','bonds','notes','interestAccruals','dividendAccruals','slbCashCollateral','slbDirectSecuritiesBorrowed','slbDirectSecuritiesLent','softDollars','funds','crypto','cfdUnrealizedPl','forexCfdUnrealizedPl','ipoSubscription','physDel'];
function prepare(decoded,account) {
 const identifiers=new Set([account.account_identifier,`****${String(account.account_identifier).slice(-4)}`]);
 const points=new Map();
 for(const row of decoded.nav_records||[]) {
  if(!identifiers.has(row.accountId)&&account.account_identifier!==`****${String(row.accountId).slice(-4)}`)throw Error('IBKR NAV account does not match managed account');
  if(account.currency!=='USD'||row.currency!=='USD')throw Error('IBKR NAV history currently requires a USD base account');
  const date=reportDate(row.reportDate),from=reportDate(row.fromDate),to=reportDate(row.toDate);
  // Reports include the previous closing NAV as their opening observation.
  if(date<day(Date.parse(from)-7*86400000)||date>to)throw Error('IBKR NAV date is outside statement coverage');
  if(row.total==null||row.total===''||row.cash==null||row.cash==='')throw Error('IBKR NAV total or cash is missing');
  const total=Number(row.total),cash=Number(row.cash),parts=components.map(k=>Number(row[k]||0));
  if(!Number.isFinite(total)||!Number.isFinite(cash)||parts.some(v=>!Number.isFinite(v))||Math.abs(parts.reduce((s,v)=>s+v,0)-total)>.02)throw Error('IBKR NAV components do not reconcile');
  const point={date,total,cash,holdings:total-cash};
  if(points.has(date)&&(Math.abs(points.get(date).total-total)>.02||Math.abs(points.get(date).cash-cash)>.02))throw Error('Conflicting IBKR NAV values for the same date');
  points.set(date,point);
 }
 for(const change of decoded.nav_changes||[]) {
  const end=points.get(reportDate(change.toDate));
  if(end&&(!Number.isFinite(Number(change.endingValue))||Math.abs(Number(change.endingValue)-end.total)>.02))throw Error('IBKR ending NAV differs from daily summary');
 }
 return [...points.values()].filter(p=>p.date>=day(account.initial_balance_date)).sort((a,b)=>a.date.localeCompare(b.date));
}
function weekendPoints(points,ledger) {
 const balanceAt=date=>{const row=(ledger?.rows||[]).filter(r=>r.date<=date).at(-1);return row?Number(row.balance):Number(ledger?.openingBalance);};
 const out=[];
 for(let i=0;i<points.length-1;i++) {
  const prior=points[i],next=points[i+1];
  if(Date.parse(next.date)-Date.parse(prior.date)>3*86400000)continue;
  for(let t=Date.parse(prior.date)+86400000;t<Date.parse(next.date);t+=86400000) {
   const date=day(new Date(t)),weekday=new Date(t).getUTCDay();
   const currentCash=balanceAt(date),priorCash=balanceAt(prior.date);
   if(![0,6].includes(weekday)||!Number.isFinite(currentCash)||!Number.isFinite(priorCash))continue;
   out.push({date,holdings:prior.holdings,cash:prior.cash+currentCash-priorCash});
  }
 }
 return out;
}
async function saveNavReports(connection,decoded) {
 if(!decoded.nav_records?.length)return {saved:0,weekends:0};
 const accounts=(await db.query("SELECT * FROM user_accounts WHERE user_id=$1 AND broker='ibkr' AND NOT is_archived",[connection.userId])).rows;
 const groups=new Map();
 for(const row of decoded.nav_records) {
  const matches=accounts.filter(a=>a.account_identifier===row.accountId||a.account_identifier===`****${String(row.accountId).slice(-4)}`);
  if(matches.length!==1)throw Error('IBKR NAV must match exactly one managed account');
  const a=matches[0];if(!groups.has(a.id))groups.set(a.id,{account:a,rows:[]});groups.get(a.id).rows.push(row);
 }
 let saved=0,weekends=0;
 for(const {account,rows} of groups.values()) {
  const points=prepare({...decoded,nav_records:rows,nav_changes:(decoded.nav_changes||[]).filter(c=>c.accountId===rows[0].accountId)},account);
  if(!points.length)continue;
  const ledger=await loadLedger(connection.userId,account,points[0].date,points.at(-1).date);
  const carried=ledger?.reconciliation?.matched===false?[]:weekendPoints(points,ledger);
  await db.withTransaction(async client=>{
   for(const [source,observations] of [['statement',points],['weekend',carried]])for(const p of observations) {
    const rate=(await client.query("SELECT rates FROM fx_daily_rates WHERE base_code='USD' AND rate_date<=$1 AND rate_date >= $1::date-7 ORDER BY rate_date DESC LIMIT 1",[p.date])).rows[0]?.rates.GBP;
    if(source==='statement')await client.query(`INSERT INTO portfolio_statement_values(user_id,account_identifier,value_date,holdings_usd,cash_usd,gbp_per_usd) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,account_identifier,value_date) DO UPDATE SET holdings_usd=EXCLUDED.holdings_usd,cash_usd=EXCLUDED.cash_usd,gbp_per_usd=EXCLUDED.gbp_per_usd,recorded_at=NOW()`,[connection.userId,account.account_identifier,p.date,p.holdings,p.cash,rate||null]);
    else await client.query(`INSERT INTO portfolio_reconstructed_values(user_id,account_identifier,value_date,holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd,issues,method) VALUES($1,$2,$3,$4,$5,0,$6,$7::jsonb,$8) ON CONFLICT(user_id,account_identifier,value_date) DO UPDATE SET holdings_usd=EXCLUDED.holdings_usd,cash_usd=EXCLUDED.cash_usd,stablecoins_usd=0,gbp_per_usd=EXCLUDED.gbp_per_usd,issues=EXCLUDED.issues,method=EXCLUDED.method,reconstructed_at=NOW()`,[connection.userId,account.account_identifier,p.date,p.holdings,p.cash,rate||null,JSON.stringify(['Estimated using previous IBKR statement: weekend holdings at last reported close']),'IBKR reported NAV holdings including accruals carried over weekend; cash adjusted by saved native cash ledger']);
   }
  });
  saved+=points.length;weekends+=carried.length;
 }
 return {saved,weekends};
}
async function backfillTrailingWeekends(userId,account) {
 const latest=(await db.query(`SELECT * FROM portfolio_statement_values WHERE user_id=$1 AND account_identifier=$2 ORDER BY value_date DESC LIMIT 1`,[userId,account.account_identifier])).rows[0];
 if(!latest)return 0;
 const today=day(new Date()),date=day(latest.value_date);
 if(date>=today||Date.parse(today)-Date.parse(date)>3*86400000)return 0;
 const ledger=await loadLedger(userId,account,date,today);
 if(!ledger||ledger.reconciliation?.matched===false)return 0;
 const points=weekendPoints([{date,holdings:Number(latest.holdings_usd),cash:Number(latest.cash_usd)},
  {date:day(new Date(Date.parse(today)+86400000))}],ledger);
 await db.withTransaction(async client=>{
  for(const p of points) {
   const rate=(await client.query("SELECT rates FROM fx_daily_rates WHERE base_code='USD' AND rate_date<=$1 AND rate_date >= $1::date-7 ORDER BY rate_date DESC LIMIT 1",[p.date])).rows[0]?.rates.GBP;
   await client.query(`INSERT INTO portfolio_reconstructed_values(user_id,account_identifier,value_date,holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd,issues,method)
    VALUES($1,$2,$3,$4,$5,0,$6,$7::jsonb,$8) ON CONFLICT(user_id,account_identifier,value_date) DO UPDATE SET
    holdings_usd=EXCLUDED.holdings_usd,cash_usd=EXCLUDED.cash_usd,gbp_per_usd=EXCLUDED.gbp_per_usd,issues=EXCLUDED.issues,method=EXCLUDED.method,reconstructed_at=NOW()`,
    [userId,account.account_identifier,p.date,p.holdings,p.cash,rate||null,JSON.stringify(['Estimated using previous IBKR statement: weekend holdings at last reported close']),
     'IBKR last reported NAV holdings; weekend cash adjusted using native cash ledger']);
  }
 });
 return points.length;
}
module.exports={prepare,weekendPoints,saveNavReports,backfillTrailingWeekends};
