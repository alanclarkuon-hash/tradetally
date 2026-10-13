// Compare persisted valuation inputs, not sync counters or changing live quotes.
// Only hashes and dates survive this in-memory comparison; job scopes contain
// account identifiers/date boundaries, never broker records or credentials.
const db = require('../config/database');
const { createHash } = require('crypto');
const day = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString().slice(0,10) : null;
const stable = v => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().filter(k=>!['updated_at','created_at','recorded_at','captured_at','fetched_at'].includes(k)).map(k=>[k,stable(v[k])])) : v;
function add(rows, value, date, fallback) {
 const hash=createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
 const key=hash+':'+(day(date)||fallback);
 rows.set(key,{date:day(date)||fallback,count:(rows.get(key)?.count||0)+1});
}
async function capture(userId, broker, connectionId) {
 const snapshots=(await db.query('SELECT account_identifier,connection_id,payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type=$2',[userId,broker])).rows;
 const own=snapshots.filter(s=>s.connection_id===connectionId).map(s=>s.account_identifier);
 const brokerAccounts=(await db.query('SELECT id,account_identifier,initial_balance_date,initial_balance,currency FROM user_accounts WHERE user_id=$1 AND broker=$2 AND NOT is_archived AND account_identifier IS NOT NULL',[userId,broker])).rows;
 // Legacy snapshots may retain a broker-native identifier after an account
 // rename. Fall back to this broker's accounts rather than silently skipping it.
 const matched=brokerAccounts.filter(a=>own.includes(a.account_identifier));
 const accounts=matched.length?matched:brokerAccounts;
 const result=new Map();
 for(const a of accounts) {
  const rows=new Map(), fallback=day(a.initial_balance_date);
  add(rows,{opening:a.initial_balance,currency:a.currency},fallback,fallback);
  const trades=(await db.query(`SELECT symbol,instrument_type,underlying_symbol,entry_time,exit_time,trade_date,quantity,entry_price,exit_price,side,executions FROM trades WHERE user_id=$1 AND broker=$2 AND account_identifier=$3`,[userId,broker,a.account_identifier])).rows;
  for(const t of trades)add(rows,t,t.entry_time||t.trade_date,fallback);
  const reports=(await db.query('SELECT records,from_date,to_date,starting_cash,ending_cash,currency FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2',[userId,a.id])).rows;
  for(const r of reports) {
   add(rows,{opening:r.starting_cash,currency:r.currency,from:day(r.from_date)},r.from_date,fallback);
   add(rows,{closing:r.ending_cash,currency:r.currency,to:day(r.to_date)},r.to_date,fallback);
   for(const record of r.records||[])add(rows,record,record.date||record.time||record.timestamp,day(r.from_date)||fallback);
  }
  const cash=(await db.query('SELECT event_date,event_type,amount,currency,metadata FROM broker_cash_events WHERE user_id=$1 AND account_id=$2',[userId,a.id])).rows;
  for(const c of cash)add(rows,c,c.event_date,fallback);
  const nav=(await db.query('SELECT value_date,holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd FROM portfolio_statement_values WHERE user_id=$1 AND account_identifier=$2',[userId,a.account_identifier])).rows;
  for(const n of nav)add(rows,n,n.value_date,fallback);
  const payload=snapshots.find(s=>s.account_identifier===a.account_identifier)?.payload;
  if (payload?.asOf) add(rows,{coverage:day(payload.asOf)},payload.asOf,fallback);
  if (payload?.ledger || payload?.bills) add(rows,{reconciled:payload.reconciled,nativeMatched:payload.nativeReconciliation?.nativeBalancesMatched,historyComplete:payload.historyComplete},fallback,fallback);
  for(const l of Object.values(payload?.ledger||{}))add(rows,l,Number.isFinite(Number(l.time)) ? new Date(Number(l.time)*1000).toISOString() : null,fallback);
  for(const b of payload?.bills||[])add(rows,b,Number.isFinite(Number(b.ts)) ? new Date(Number(b.ts)).toISOString() : null,fallback);
  const latest=(await db.query('SELECT MAX(value_date) AS latest FROM portfolio_reconstructed_values WHERE user_id=$1 AND account_identifier=$2',[userId,a.account_identifier])).rows[0]?.latest;
  result.set(a.account_identifier,{rows,fallback,latest:broker==='ibkr' ? nav.map(n=>day(n.value_date)).filter(Boolean).sort().at(-1) : day(latest)});
 }
 return result;
}
function difference(before,after,until=new Date(Date.now()-86400000).toISOString().slice(0,10)) {
 const accounts={};
 for(const [id,current] of after) {
  const previous=before.get(id),dates=[];
  for(const [key,row] of current.rows)if(row.count!==previous?.rows.get(key)?.count)dates.push(row.date);
  for(const [key,row] of previous?.rows||[])if(row.count!==current.rows.get(key)?.count)dates.push(row.date);
  if(!current.latest)dates.push(current.fallback);
  else if(current.latest<until)dates.push(current.latest);
  if(dates.length)accounts[id]=dates.some(d=>!d)?current.fallback:dates.sort()[0];
 }
 return {accounts};
}
module.exports={capture,difference};
