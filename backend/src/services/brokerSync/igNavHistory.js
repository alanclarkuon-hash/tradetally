const db=require('../../config/database');
const {cents}=require('./igStatement');
const {localToUTC}=require('../../utils/timezone');
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
function readSpreadStatement(text,base,report) {
  const mask=text.match(/Account No\.\s*([A-Z0-9*]+)/)?.[1];
  const label=text.match(/Account Name\s+([^\r\n]+)/)?.[1]?.trim();
  if(base.kind!=='spread_bet'||mask!==base.statementMask||label!==base.statementLabel)throw Error('IG statement account identity does not match');
  const match=text.match(/\b(\d{2}) (January|February|March|April|May|June|July|August|September|October|November|December) (20\d{2})\b/);
  if(!match)throw Error('IG statement valuation date is unavailable');
  const date=`${match[3]}-${String(months.indexOf(match[2])+1).padStart(2,'0')}-${match[1]}`;
  if(new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Invalid IG statement date');
  const value=key=>{const m=text.match(new RegExp('\\b'+key+'\\s+(-?[\\d,]+\\.\\d{2})'));if(!m)throw Error('IG statement equity summary is incomplete');return cents(m[1])/100;};
  const cash=value('Funds'),holdings=value('Running Profit Or Loss'),total=value('Equity');
  if(cents(cash)+cents(holdings)!==cents(total))throw Error('IG statement equity does not reconcile');
  if(date<day(report.from_date)||date>day(base.confirmation.cutoff))throw Error('IG statement is outside saved account coverage');
  const close=new Date(localToUTC(date+'T23:59:59','Europe/London')).toISOString();
  const previous=new Date(Date.parse(localToUTC(date+'T00:00:00','Europe/London'))-1).toISOString();
  const balance=cutoff=>cents(report.starting_cash)+report.records.filter(r=>r.time<=cutoff).reduce((sum,r)=>sum+cents(r.cash),0);
  if(balance(close)!==cents(cash)&&balance(previous)!==cents(cash))throw Error('IG statement cash differs from saved cash history');
  return {date,cash,holdings};
}
async function savePoint(client,userId,identifier,point,knownFx) {
  if(!Number.isFinite(point.cash)||!Number.isFinite(point.holdings))throw Error('IG statement values are incomplete');
  const fx=knownFx??(await client.query("SELECT rates FROM fx_daily_rates WHERE base_code='USD' AND rate_date<=$1 AND rate_date >= $1::date-7 ORDER BY rate_date DESC LIMIT 1",[point.date])).rows[0]?.rates.GBP;
  if(!(Number(fx)>0))throw Error('Dated GBP conversion is unavailable for IG statement');
  await client.query(`INSERT INTO portfolio_statement_values(user_id,account_identifier,value_date,holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd)
    VALUES($1,$2,$3,$4,$5,0,$6) ON CONFLICT(user_id,account_identifier,value_date) DO UPDATE SET
    holdings_usd=EXCLUDED.holdings_usd,cash_usd=EXCLUDED.cash_usd,stablecoins_usd=0,gbp_per_usd=EXCLUDED.gbp_per_usd`,
  [userId,identifier,point.date,point.holdings/Number(fx),point.cash/Number(fx),Number(fx)]);
}
async function captureSpreadStatement(userId,text) {
  const accounts=(await db.query(`SELECT a.account_identifier,s.payload,r.from_date,r.starting_cash,r.records
    FROM user_accounts a JOIN broker_import_snapshots s ON s.user_id=a.user_id AND s.account_identifier=a.account_identifier AND s.broker_type='ig'
    JOIN broker_cash_reports r ON r.account_id=a.id AND r.broker_type='ig'
    WHERE a.user_id=$1 AND a.broker='ig' AND a.currency='GBP' AND NOT a.is_archived`,[userId])).rows;
  const matches=accounts.filter(a=>a.payload.igFileInput.kind==='spread_bet'&&
    text.match(/Account No\.\s*([A-Z0-9*]+)/)?.[1]===a.payload.igFileInput.statementMask&&
    text.match(/Account Name\s+([^\r\n]+)/)?.[1]?.trim()===a.payload.igFileInput.statementLabel);
  if(matches.length!==1)throw Error('IG statement must match exactly one saved account');
  const a=matches[0],point=readSpreadStatement(text,a.payload.igFileInput,a);
  await db.withTransaction(client=>savePoint(client,userId,a.account_identifier,point));
  return {date:point.date};
}
async function saveConfirmation(client,userId,account,rates) {
  const c=account.confirmation,date=day(c.openBets?.[0]?.asOf||c.cutoff);
  const holdings=account.kind==='spread_bet'?(c.openBets||[]).reduce((sum,p)=>sum+p.unrealizedPnL,0)
    :(c.holdings||[]).reduce((sum,h)=>sum+h.value,0);
  await savePoint(client,userId,account.identifier,{date,cash:c.cash,holdings},rates?.get(date)>0?1/rates.get(date):undefined);
}
module.exports={readSpreadStatement,savePoint,captureSpreadStatement,saveConfirmation};
