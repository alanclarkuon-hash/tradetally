const crypto = require('crypto');
const db = require('../../config/database');
const { statementDate } = require('./etoroStatement');
const dateKey = v => v instanceof Date ? v.toISOString().slice(0,10) : String(v).slice(0,10);

function number(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) throw Error('Incomplete eToro cash statement');
  return Number(value);
}
function prepare(statement, {startingCash=0}={}) {
  const activity = statement['Account Activity'], dividends = statement.Dividends;
  if (!Array.isArray(activity) || !activity.length || !Array.isArray(dividends)) throw Error('Missing eToro cash sheets');
  const queues = new Map(), dividendIndexes = new Set();
  const key = (date, id, amount) => [date,id,Math.round(amount*100)].join('|');
  activity.forEach((r,i) => {
    if (!['Dividend','Overnight fee','Overnight refund','Weekend refund'].includes(r.Type)) return;
    const k=key(statementDate(r.Date).slice(0,10),r['Position ID'],number(r.Amount));
    if (!queues.has(k)) queues.set(k,[]);
    queues.get(k).push(i);
  });
  // Match occurrences, not just equal amounts: identical legitimate payments
  // must survive, while a duplicated detail row must not create extra cash.
  let unmatchedDividendDetails=0;const unmatchedDividendDates=[];
  for (const r of dividends) {
    const date=statementDate(`${r['Date of Payment']} 00:00:00`).slice(0,10);
    const q=queues.get(key(date,r['Position ID'],number(r['Net Dividend Received (USD)'])));
    if (q?.length) dividendIndexes.add(q.shift()); else {unmatchedDividendDetails++;unmatchedDividendDates.push(date);}
  }
  const counts=new Map(); let previousBalance=number(startingCash),previousTime='';
  const records=activity.map((r,i) => {
    const time=statementDate(r.Date),date=time.slice(0,10),amount=number(r.Amount),balance=number(r.Balance);
    if (time<previousTime) throw Error('eToro cash activity is not chronological');
    previousTime=time;
    const cash=balance-previousBalance; previousBalance=balance;
    let type=null;
    if (r.Type==='Dividend' || dividendIndexes.has(i)) type='dividend';
    else if (['Interest Payment','Staking'].includes(r.Type)) type='interest';
    else if (['Overnight fee','Overnight refund','Weekend refund','Opening and Closing Spread'].includes(r.Type)) type='account_fee';
    else if (r.Type==='SDRT') type='tax';
    else if (r.Type==='Deposit') type='deposit';
    else if (['Withdraw Request','Transfer: USD > GBP'].includes(r.Type)) type='withdrawal';
    // Funding is scoped to the USD investment account: transfers out to GBP
    // are withdrawals from this account, without claiming a bank withdrawal.
    // Conversion fee rows can carry the whole settlement in Balance while
    // Amount is only a fee. Cash balance still uses actual Balance deltas.
    const signature=JSON.stringify([time,r.Type,r['Position ID'] ?? null,amount,number(r['Realized Equity Change'])]);
    const hash=crypto.createHash('sha256').update(signature).digest('hex');
    const occurrence=(counts.get(hash)||0)+1;counts.set(hash,occurrence);
    return {reference:`statement:${hash}:${occurrence}`,date,time,sourceType:r.Type,type,amount,cash,
      description: r.Type==='Staking'?'Staking reward':r.Type==='Transfer: USD > GBP'?'Transfer out: USD > GBP':r.Type,
      positionId:r['Position ID'] == null ? null : String(r['Position ID'])};
  });
  return {records,events:records.filter(r=>r.type),from:records[0].date,to:records.at(-1).date,
    endingCash:previousBalance,unmatchedDividendDetails,unmatchedDividendDates};
}

async function importStatement(connection, statement, {dryRun=false}={}) {
  const data=prepare(statement);
  const identifier=`eToro ****${String(connection.externalAccountId).slice(-4)}`;
  const accounts=(await db.query(`SELECT * FROM user_accounts WHERE user_id=$1 AND broker='etoro' AND account_identifier=$2`,[connection.userId,identifier])).rows;
  if(accounts.length!==1 || accounts[0].currency!=='USD' || Number(accounts[0].initial_balance)!==0 || dateKey(accounts[0].initial_balance_date)!==data.from)
    throw Error('eToro statement needs one matching USD account with zero opening balance on its first activity date');
  if(dryRun) return {events:data.events.length,records:data.records.length,unmatchedDividendDetails:data.unmatchedDividendDetails};
  return db.withTransaction(async client=>{
    let imported=0,matched=0;
    for(const e of data.events){
      const result=await client.query(`INSERT INTO broker_cash_events(user_id,account_id,broker_type,reference_id,event_type,event_date,amount,currency,amount_usd,description)
        VALUES($1,$2,'etoro',$3,$4,$5,$6,'USD',$6,$7)
        ON CONFLICT(user_id,account_id,broker_type,reference_id) DO UPDATE SET event_type=EXCLUDED.event_type,amount=EXCLUDED.amount,
        amount_usd=EXCLUDED.amount_usd,description=EXCLUDED.description,updated_at=NOW() RETURNING (xmax=0) AS inserted`,
      [connection.userId,accounts[0].id,e.reference,e.type,e.date,e.amount,e.description]);
      if(result.rows[0].inserted) imported++;else matched++;
    }
    await client.query(`INSERT INTO broker_cash_reports(user_id,account_id,broker_type,from_date,to_date,currency,starting_cash,ending_cash,records)
      VALUES($1,$2,'etoro',$3,$4,'USD',0,$5,$6::jsonb)
      ON CONFLICT(user_id,account_id,broker_type,from_date,to_date) DO UPDATE SET ending_cash=EXCLUDED.ending_cash,records=EXCLUDED.records,updated_at=NOW()`,
    [connection.userId,accounts[0].id,data.from,data.to,data.endingCash,JSON.stringify(data.records)]);
    return {imported,matched,unmatchedDividendDetails:data.unmatchedDividendDetails};
  });
}

async function loadLedger(userId,account,start,end){
  if(account.broker!=='etoro') return null;
  const report=(await db.query(`SELECT * FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='etoro' ORDER BY to_date DESC,updated_at DESC LIMIT 1`,[userId,account.id])).rows[0];
  if(!report) return null;
  if(report.currency!==account.currency) throw Error('eToro cash statement currency differs from account');
  const rows=new Map();let balance=Number(report.starting_cash),openingBalance=balance;
  for(const e of report.records){
    if(e.date>end) continue;
    const r=rows.get(e.date)||{date:e.date,trade_inflow:0,trade_outflow:0,fees:0,deposits:0,withdrawals:0,income:0,account_fees:0,withholding_tax:0,inflow:0,outflow:0};
    if(e.cash>=0)r.inflow+=e.cash;else r.outflow-=e.cash;
    if(['Open Position','Position closed'].includes(e.sourceType)){if(e.cash>=0)r.trade_inflow+=e.cash;else r.trade_outflow-=e.cash;}
    if(e.type==='deposit')r.deposits+=e.amount;
    if(e.type==='withdrawal')r.withdrawals-=e.amount;
    if(['interest','dividend'].includes(e.type))r.income+=e.amount;
    if(e.type==='account_fee'){r.account_fees-=e.amount;r.fees-=e.amount;}
    if(e.type==='tax')r.withholding_tax-=e.amount;
    balance+=e.cash;if(e.date<start)openingBalance=balance;
    r.net=r.inflow-r.outflow;r.balance=balance;rows.set(e.date,r);
  }
  const reportDate=dateKey(report.to_date),closed=reportDate<=end;
  const connections=(await db.query(`SELECT broker_metadata->'cash_balance' AS cash FROM broker_connections
    WHERE user_id=$1 AND broker_type='etoro' AND broker_metadata->'cash_balance'->>'accountIdentifier'=$2`,
  [userId,account.account_identifier])).rows;
  const cash=connections.length===1 ? connections[0].cash : null;
  const liveCash=cash?.currency===account.currency && typeof cash.amount==='number' && Number.isFinite(cash.amount)
    && Number.isFinite(Date.parse(cash.asOf)) ? {amount:cash.amount,currency:cash.currency,asOf:cash.asOf} : null;
  return {rows:[...rows.values()].filter(r=>r.date>=start),openingBalance,balance,report,source:'etoro_statement',
    liveCash,
    reconciliation:closed?{statementDate:reportDate,reportedBalance:Number(report.ending_cash),calculatedBalance:balance,
      difference:balance-Number(report.ending_cash),matched:Math.abs(balance-Number(report.ending_cash))<.02}:null,
    fundingPending:false};
}
async function dayActivity(userId,account,date){
  const ledger=await loadLedger(userId,account,date,date);if(!ledger)return null;
  return {date,trades:[],transactions:ledger.report.records.filter(e=>e.date===date && Math.abs(e.cash)>.00001).map(e=>({id:e.reference,
    transactionType:e.type || 'transfer_or_adjustment',amount:Math.abs(e.cash),signedAmount:e.cash,
    description:e.description,sourceType:'etoro',originalAmount:e.amount,originalCurrency:'USD'}))};
}
module.exports={prepare,importStatement,loadLedger,dayActivity};
