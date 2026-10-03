const db=require('../config/database');
const crypto=require('crypto');
const {prepare}=require('./brokerSync/etoroCashStatement');
const {read}=require('./brokerSync/etoroWorkbook');
const day=v=>new Date(v).toISOString().slice(0,10);
async function captureEtoroStatement(userId,accountId,buffer) {
 const upload=await read(buffer);
 if(!upload.equity)throw Error('Statement equity totals are unavailable');
 const account=(await db.query(`SELECT a.*,c.broker_metadata FROM user_accounts a JOIN broker_connections c ON c.user_id=a.user_id AND c.broker_type='etoro' AND a.account_identifier=('eToro ****'||RIGHT(c.external_account_id,4)) WHERE a.user_id=$1 AND a.id=$2 AND a.broker='etoro' AND NOT a.is_archived`,[userId,accountId])).rows[0];
 const hash=crypto.createHash('sha256').update(JSON.stringify(upload.username)).digest('hex');
 if(!account||account.currency!=='USD'||account.broker_metadata?.statement_identity_hash!==hash)throw Error('Statement account identity has not matched');
 const report=(await db.query("SELECT * FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='etoro' ORDER BY to_date DESC,updated_at DESC LIMIT 1",[userId,accountId])).rows[0];
 const first=report?.records.findIndex(r=>r.time===require('./brokerSync/etoroStatement').statementDate(upload.statement['Account Activity'][0].Date));
 if(first==null||first<0||upload.end>day(report.to_date))throw Error('Statement activity is outside saved coverage');
 const opening=Number(report.starting_cash)+report.records.slice(0,first).reduce((s,r)=>s+r.cash,0);
 const prepared=prepare(upload.statement,{startingCash:opening});
 const saved=report.records.slice(first).filter(r=>r.date<=upload.end);
 if(saved.length!==prepared.records.length||prepared.records.some((r,i)=>r.reference!==saved[i].reference||Math.abs(r.cash-saved[i].cash)>.00001))throw Error('Statement cash activity differs from saved records');
 const endpoints=[{date:day(Date.parse(upload.start)-86400000),total:upload.equity.openingTotalUSD}, {date:upload.end,total:upload.equity.closingTotalUSD}];
 let captured=0;
 await db.withTransaction(async client=>{
  for(const point of endpoints) {
   if(point.date<day(account.initial_balance_date))continue;
   const cash=Number(report.starting_cash)+report.records.filter(r=>r.date<=point.date).reduce((s,r)=>s+r.cash,0);
   if(!(point.total>=cash-.02)||!Number.isFinite(point.total))throw Error('Statement equity does not cover its cash balance');
   const fx=(await client.query("SELECT rates FROM fx_daily_rates WHERE base_code='USD' AND rate_date<=$1 AND rate_date >= $1::date-7 ORDER BY rate_date DESC LIMIT 1",[point.date])).rows[0]?.rates.GBP;
   await client.query(`INSERT INTO portfolio_statement_values(user_id,account_identifier,value_date,holdings_usd,cash_usd,gbp_per_usd) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,account_identifier,value_date) DO UPDATE SET holdings_usd=EXCLUDED.holdings_usd,cash_usd=EXCLUDED.cash_usd,gbp_per_usd=EXCLUDED.gbp_per_usd`,[userId,account.account_identifier,point.date,point.total-cash,cash,fx||null]);
   captured++;
  }
 });
 return {captured};
}
module.exports={captureEtoroStatement};
