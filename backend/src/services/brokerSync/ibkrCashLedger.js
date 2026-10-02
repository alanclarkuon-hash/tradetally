const db = require('../../config/database');
const {field} = require('./ibkrCashEvents');
const dateKey = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
function reportDate(value) {
  const raw=String(value || '').split(/[;T ]/)[0];
  const date=/^\d{8}$/.test(raw) ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}` : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('Invalid IBKR cash ledger date');
  return date;
}
function ledgerRow(row) {
  const code=field(row,'activityCode').toUpperCase();
  if (!code) return null; // Opening/closing balance labels are not cash events.
  const amount=Number(field(row,'amount'));
  const commission=Number(field(row,'tradeCommission') || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(commission)) throw new Error('Invalid IBKR cash ledger amount');
  return {date:reportDate(field(row,'date')),code,amount,commission,
    quantity:Math.abs(Number(field(row,'tradeQuantity') || 0)),price:Number(field(row,'tradePrice') || 0),
    description:field(row,'activityDescription'),reference:field(row,'transactionID'),
    symbol:field(row,'symbol'),currency:field(row,'currency')};
}
function validateReport(statement,sections,account) {
  const from=reportDate(statement.from_date),to=reportDate(statement.to_date);
  const raw=(sections.statement_of_funds || []).filter(r => field(r,'accountId','account')===statement.account_id && field(r,'levelOfDetail').toLowerCase()==='basecurrency');
  if (!raw.length) return null;
  if (raw.some(r=>field(r,'currency')!==account.currency)) throw new Error('IBKR base cash ledger currency does not match the managed account');
  const summary=(sections.cash_report || []).find(r => field(r,'accountId','account')===statement.account_id && field(r,'currency')==='BASE_SUMMARY');
  if (!summary) throw new Error('IBKR base cash summary is missing');
  const starting=Number(field(summary,'startingCash')),ending=Number(field(summary,'endingCash'));
  const records=raw.map(ledgerRow).filter(Boolean);
  if (!Number.isFinite(starting) || !Number.isFinite(ending) || records.some(r=>r.date<from || r.date>to)) throw new Error('Invalid IBKR cash statement coverage');
  const computed=starting+records.reduce((sum,r)=>sum+r.amount,0);
  if (Math.abs(computed-ending)>0.02) throw new Error('IBKR cash ledger does not reconcile with its statement closing balance');
  return {from,to,currency:account.currency,starting,ending,records};
}
async function saveCashReports(connection,decoded) {
  const accounts=(await db.query("SELECT id,account_identifier,currency FROM user_accounts WHERE user_id=$1 AND broker='ibkr'",[connection.userId])).rows;
  const reports=[];
  for (const s of decoded.statements || []) {
    const matches=accounts.filter(a=>[s.account_id,`****${String(s.account_id).slice(-4)}`].includes(a.account_identifier));
    if (matches.length!==1) throw new Error('IBKR cash report must match exactly one managed account');
    const report=validateReport(s,decoded.cash_sections || {},matches[0]);
    if (report) reports.push({...report,accountId:matches[0].id});
  }
  await db.withTransaction(async client=>{
    for (const r of reports) await client.query(`INSERT INTO broker_cash_reports(user_id,account_id,broker_type,from_date,to_date,currency,starting_cash,ending_cash,records)
      VALUES($1,$2,'ibkr',$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT(user_id,account_id,broker_type,from_date,to_date) DO UPDATE SET currency=EXCLUDED.currency,
      starting_cash=EXCLUDED.starting_cash,ending_cash=EXCLUDED.ending_cash,records=EXCLUDED.records,updated_at=NOW()`,
    [connection.userId,r.accountId,r.from,r.to,r.currency,r.starting,r.ending,JSON.stringify(r.records)]);
  });
  return {saved:reports.length};
}
// Weighted interval selection keeps overlapping rolling sync reports from
// duplicating transactions or period-specific FX translation adjustments.
function selectReports(input) {
  const reports=input.map(r=>({...r,from_date:dateKey(r.from_date),to_date:dateKey(r.to_date)}))
    .sort((a,b)=>a.to_date.localeCompare(b.to_date)||a.from_date.localeCompare(b.from_date));
  const best=[{weight:0,rows:[]}];
  for (let i=0;i<reports.length;i++) {
    let previous=i-1;
    while (previous>=0 && reports[previous].to_date>=reports[i].from_date) previous--;
    const weight=(Date.parse(reports[i].to_date)-Date.parse(reports[i].from_date))/86400000+1;
    const take={weight:best[previous+1].weight+weight,rows:[...best[previous+1].rows,reports[i]]};
    best.push(take.weight>=best[i].weight ? take : best[i]);
  }
  return best[reports.length].rows;
}
function dailyRows(reports,start,end) {
  const byDate=new Map();
  for (const report of reports) for (const event of report.records) {
    if (event.date<start || event.date>end) continue;
    const r=byDate.get(event.date) || {date:event.date,trade_inflow:0,trade_outflow:0,fees:0,deposits:0,withdrawals:0,income:0,account_fees:0,withholding_tax:0,fx_adjustments:0,inflow:0,outflow:0};
    const amount=Number(event.amount);
    if (amount>=0) r.inflow+=amount; else r.outflow-=amount;
    if (event.code==='BUY' || event.code==='SELL') {
      if (amount>=0) r.trade_inflow+=amount; else r.trade_outflow-=amount;
      r.fees-=event.commission;
    }
    if (event.code==='DEP') r.deposits+=amount;
    if (event.code==='WITH') r.withdrawals-=amount;
    if (['DIV','PIL','CINT','DINT','INTP','INTR'].includes(event.code)) r.income+=amount;
    if (['OFEE','MFEE'].includes(event.code)) {r.account_fees-=amount;r.fees-=amount;}
    if (['FRTAX','STAX'].includes(event.code)) r.withholding_tax-=amount;
    if (event.code==='FOREX' || (event.code==='ADJ' && /FX Translations/i.test(event.description))) r.fx_adjustments+=amount;
    if (event.code==='FOREX') r.fees-=event.commission;
    byDate.set(event.date,r);
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({...r,net:r.inflow-r.outflow}));
}
async function loadLedger(userId,account,start,end) {
  if (account.broker!=='ibkr') return null;
  const rows=(await db.query(`SELECT * FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='ibkr'
    AND from_date <= $3 ORDER BY from_date,to_date,updated_at`,[userId,account.id,end])).rows;
  if (!rows.length) return null;
  const reports=selectReports(rows);
  if (reports[0].from_date>dateKey(account.initial_balance_date)) return null;
  if (reports.some(r=>r.currency!==account.currency)) throw new Error('Saved IBKR ledger currency differs from account');
  const last=reports[reports.length-1];
  const opening=Number(account.initial_balance || 0);
  const full=dailyRows(reports,dateKey(account.initial_balance_date),end);
  let balance=opening;
  for (const row of full) {balance+=row.net;row.balance=balance;}
  const reportClosed=last.to_date<=end;
  const reconciliation=reportClosed ? {statementDate:last.to_date,reportedBalance:Number(last.ending_cash),
    calculatedBalance:balance,difference:balance-Number(last.ending_cash),matched:Math.abs(balance-Number(last.ending_cash))<=0.02} : null;
  return {rows:full.filter(r=>r.date>=start),balance,reconciliation,reports,
    openingBalance:opening+full.filter(r=>r.date<start).reduce((sum,r)=>sum+r.net,0)};
}
async function dayActivity(userId,account,date) {
  const ledger=await loadLedger(userId,account,date,date);
  if (!ledger) return null;
  const records=ledger.reports.flatMap(r=>r.records).filter(e=>e.date===date);
  const native=(await db.query('SELECT reference_id,amount,currency FROM broker_cash_events WHERE user_id=$1 AND account_id=$2 AND event_date=$3',[userId,account.id,date])).rows;
  const types={DEP:'deposit',WITH:'withdrawal',CINT:'interest',DINT:'interest',INTP:'interest',INTR:'interest',DIV:'dividend',PIL:'dividend',OFEE:'account_fee',MFEE:'account_fee',FRTAX:'tax',STAX:'tax',FOREX:'currency_exchange',ADJ:'currency_translation'};
  return {date,trades:records.filter(e=>['BUY','SELL'].includes(e.code)).map((e,i)=>({id:e.reference || `ledger-${i}`,symbol:e.symbol,
    side:'long',instrumentType:null,quantity:e.quantity,eventType:e.code==='BUY'?'entry':'exit',eventTime:date,
    price:e.price,grossAmount:Math.abs(e.amount),direction:e.amount>=0?'inflow':'outflow',commission:-e.commission,pnl:null})),
  transactions:records.filter(e=>!['BUY','SELL'].includes(e.code)).map((e,i)=>{
    const original=native.find(r=>r.reference_id===e.reference);
    return {id:e.reference || `ledger-cash-${i}`,transactionType:types[e.code] || 'adjustment',amount:Math.abs(e.amount),signedAmount:e.amount,
      description:e.description,sourceType:'ibkr',originalAmount:original?Number(original.amount):e.amount,originalCurrency:original?.currency || e.currency};
  })};
}
module.exports={validateReport,saveCashReports,selectReports,dailyRows,loadLedger,dayActivity};
