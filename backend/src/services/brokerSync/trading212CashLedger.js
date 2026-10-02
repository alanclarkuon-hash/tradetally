const db = require('../../config/database');
const fx = require('../../utils/currencyConverter');
const dateKey = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);

function walletRows(history, currency) {
  const events = new Map();
  for (const item of history) {
    const fill = item.fill;
    // Split pairs change share quantities, without a cash movement.
    if (fill?.type === 'STOCK_SPLIT') continue;
    if (fill?.type !== 'TRADE') throw new Error('Unsupported Trading 212 wallet event');
    const wallet = fill.walletImpact;
    const value = Number(wallet?.netValue);
    const date = dateKey(fill.filledAt);
    if (!fill.id || wallet?.netValue == null || !Number.isFinite(value) || value < 0 ||
        wallet.currency !== currency || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(fill.filledAt)) || !['BUY','SELL'].includes(item.order?.side)) {
      throw new Error('Incomplete Trading 212 wallet event');
    }
    let fees = 0;
    for (const tax of wallet.taxes || []) {
      if (tax.currency !== currency || !Number.isFinite(Number(tax.quantity))) throw new Error('Invalid Trading 212 wallet fee');
      fees -= Number(tax.quantity);
    }
    const row = {reference:String(fill.id),date,amount:value*(item.order.side==='BUY'?-1:1),fees,
      side:item.order.side,symbol:item.order.instrument?.ticker || item.order.ticker,
      quantity:Math.abs(Number(fill.quantity)),price:Number(fill.price),time:fill.filledAt};
    const previous = events.get(row.reference);
    if (previous && JSON.stringify(previous)!==JSON.stringify(row)) throw new Error('Conflicting Trading 212 wallet fills');
    events.set(row.reference,row);
  }
  return [...events.values()];
}

async function saveCashReport(connection, history, summary) {
  if (String(summary.id)!==String(connection.externalAccountId)) throw new Error('Trading 212 cash account mismatch');
  const identifier=String(connection.externalAccountId);
  const accounts=(await db.query(`SELECT * FROM user_accounts WHERE user_id=$1 AND broker='trading212'
    AND account_identifier IN ($2,$3)`,[connection.userId,identifier,`****${identifier.slice(-4)}`])).rows;
  if(accounts.length!==1) throw new Error('Trading 212 wallet needs exactly one managed account');
  const account=accounts[0];
  if(summary.currency!==account.currency) throw new Error('Trading 212 wallet currency differs from managed account');
  const records=walletRows(history,account.currency);
  const cash=summary.cash;
  if(!cash || ['availableToTrade','reservedForOrders','inPies'].some(k=>cash[k]==null || !Number.isFinite(Number(cash[k])))) throw new Error('Incomplete Trading 212 cash summary');
  const previous=(await db.query(`SELECT records FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2
    AND broker_type='trading212' ORDER BY updated_at DESC LIMIT 1`,[connection.userId,account.id])).rows[0];
  const ids=new Set(records.map(r=>r.reference));
  if(previous?.records.some(r=>!ids.has(r.reference))) throw new Error('Trading 212 wallet history does not cover the previous snapshot');
  await db.query(`INSERT INTO broker_cash_reports(user_id,account_id,broker_type,from_date,to_date,currency,starting_cash,ending_cash,records)
    VALUES($1,$2,'trading212',$3,$4,$5,$6,$7,$8::jsonb)
    ON CONFLICT(user_id,account_id,broker_type,from_date,to_date) DO UPDATE SET
    starting_cash=EXCLUDED.starting_cash,ending_cash=EXCLUDED.ending_cash,records=EXCLUDED.records,updated_at=NOW()`,
  [connection.userId,account.id,dateKey(account.initial_balance_date),new Date().toISOString().slice(0,10),account.currency,
    Number(account.initial_balance || 0),Number(cash.availableToTrade)+Number(cash.reservedForOrders)+Number(cash.inPies),JSON.stringify(records)]);
}

async function loadLedger(userId,account,start,end) {
  if(account.broker!=='trading212') return null;
  const report=(await db.query(`SELECT * FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2
    AND broker_type='trading212' ORDER BY updated_at DESC LIMIT 1`,[userId,account.id])).rows[0];
  if(!report) return null;
  if(report.currency!==account.currency) throw new Error('Saved Trading 212 wallet currency differs from account');
  const floor=dateKey(account.initial_balance_date);
  const byDate=new Map();
  const rowFor=date=>{
    if(!byDate.has(date)) byDate.set(date,{date,trade_inflow:0,trade_outflow:0,fees:0,deposits:0,withdrawals:0,income:0,account_fees:0,withholding_tax:0,inflow:0,outflow:0});
    return byDate.get(date);
  };
  for(const event of report.records) {
    if(event.date<floor || event.date>end) continue;
    const r=rowFor(event.date);
    if(event.amount>=0){r.inflow+=event.amount;r.trade_inflow+=event.amount;}
    else{r.outflow-=event.amount;r.trade_outflow-=event.amount;}
    r.fees+=event.fees; // Net wallet amounts already include these charges.
  }
  const cash=(await db.query(`SELECT * FROM broker_cash_events WHERE user_id=$1 AND account_id=$2
    AND event_date >= $3 AND event_date <= $4 ORDER BY event_date,reference_id`,[userId,account.id,floor,end])).rows;
  const manual=(await db.query(`SELECT * FROM account_transactions WHERE user_id=$1 AND account_id=$2
    AND transaction_date >= $3 AND transaction_date <= $4`,[userId,account.id,floor,end])).rows;
  for(const event of [...cash,...manual.map(e=>({...e,event_date:e.transaction_date,event_type:e.transaction_type,
    amount:(e.transaction_type==='withdrawal'?-1:1)*Number(e.amount),currency:account.currency}))]) {
    const date=dateKey(event.event_date);
    const amount=event.currency===account.currency ? Number(event.amount) :
      Number(event.amount)*await fx.getForexRate(event.currency,account.currency,date);
    if(!Number.isFinite(amount)) throw new Error('Invalid Trading 212 cash amount');
    const r=rowFor(date);
    if(amount>=0) r.inflow+=amount; else r.outflow-=amount;
    if(event.event_type==='deposit') r.deposits+=amount;
    if(event.event_type==='withdrawal') r.withdrawals-=amount;
    if(['interest','dividend'].includes(event.event_type)) r.income+=amount;
    if(event.event_type==='account_fee'){r.account_fees-=amount;r.fees-=amount;}
    if(event.event_type==='tax') r.withholding_tax-=amount;
  }
  let balance=Number(account.initial_balance || 0),openingBalance=balance;
  const full=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  for(const r of full){r.net=r.inflow-r.outflow;balance+=r.net;r.balance=balance;if(r.date<start) openingBalance=balance;}
  const reportDate=dateKey(report.to_date);
  const reconciliation=reportDate===end ? {statementDate:reportDate,reportedBalance:Number(report.ending_cash),calculatedBalance:balance,
    difference:balance-Number(report.ending_cash),matched:Math.abs(balance-Number(report.ending_cash))<=0.02} : null;
  return {rows:full.filter(r=>r.date>=start),openingBalance,balance,reconciliation,report,source:'trading212_wallet'};
}

async function dayActivity(userId,account,date) {
  const ledger=await loadLedger(userId,account,date,date);
  if(!ledger) return null;
  const native=await require('./cashflowEvents').dayEvents(userId,account.id,date,account.currency);
  const manual=(await db.query(`SELECT * FROM account_transactions WHERE user_id=$1 AND account_id=$2 AND transaction_date=$3`,[userId,account.id,date])).rows;
  return {date,trades:ledger.report.records.filter(e=>e.date===date).map(e=>({id:e.reference,
    symbol:require('./trading212Service').normalizeTicker(e.symbol),side:'long',instrumentType:'stock',quantity:e.quantity,
    eventType:e.side==='BUY'?'entry':'exit',eventTime:e.time,price:e.price,grossAmount:Math.abs(e.amount),
    direction:e.amount>=0?'inflow':'outflow',commission:e.fees,pnl:null})),transactions:[...native.events,...manual.map(e=>({id:e.id,
      transactionType:e.transaction_type,amount:Number(e.amount),signedAmount:(e.transaction_type==='withdrawal'?-1:1)*Number(e.amount),
      description:e.description,sourceType:e.source_type || 'manual'}))]};
}
module.exports={walletRows,saveCashReport,loadLedger,dayActivity};
