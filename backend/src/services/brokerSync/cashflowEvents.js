const db = require('../../config/database');
const converter = require('../../utils/currencyConverter');


async function rateFor(currency, target, date, cache) {
  if (currency === target) return 1;
  const key = `${currency}:${target}:${date}`;
  if (!cache.has(key)) cache.set(key, await converter.getForexRate(currency,target,date));
  const rate = Number(cache.get(key));
  if (!(rate > 0)) throw new Error('Cashflow currency conversion unavailable');
  return rate;
}
function dateKey(value) { return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10); }

async function enrichCashflow(userId,accountId,rows,start,end,currency = 'USD') {

  const rates = new Map();
  const byDate = new Map();
  for (const input of rows) {
    const row = {...input,date:dateKey(input.date)};
    const rate = await rateFor('USD',currency,row.date,rates);
    const oldIn = Number(row.trade_inflow || 0), oldOut = Number(row.trade_outflow || 0);
    row.trade_inflow = oldIn * rate;
    row.trade_outflow = oldOut * rate;
    row.fees = Number(row.fees || 0) * rate;
    row.inflow = Number(row.inflow || 0) - oldIn + row.trade_inflow;
    row.outflow = Number(row.outflow || 0) - oldOut + row.trade_outflow;
    row.income = 0; row.account_fees = 0; row.withholding_tax = 0;
    byDate.set(row.date,row);
  }
  const events = (await db.query(`SELECT * FROM broker_cash_events WHERE user_id=$1 AND account_id=$2
    AND event_date >= $3 AND event_date <= $4 ORDER BY event_date,reference_id`,[userId,accountId,start,end])).rows;
  for (const event of events) {
    const date = dateKey(event.event_date);
    const amount = event.currency === currency ? Number(event.amount) :
      (event.amount_usd != null ? Number(event.amount_usd) * await rateFor('USD',currency,date,rates) : Number(event.amount) * await rateFor(event.currency,currency,date,rates));
    const row = byDate.get(date) || {date,trade_inflow:0,trade_outflow:0,fees:0,deposits:0,withdrawals:0,inflow:0,outflow:0,income:0,account_fees:0,withholding_tax:0};
    if (amount >= 0) row.inflow += amount; else row.outflow -= amount;
    if (event.event_type === 'deposit') row.deposits = Number(row.deposits || 0) + amount;
    if (event.event_type === 'withdrawal') row.withdrawals = Number(row.withdrawals || 0) - amount;
    if (['dividend','interest'].includes(event.event_type)) row.income += amount;
    if (event.event_type === 'account_fee') { row.account_fees -= amount; row.fees -= amount; }
    if (event.event_type === 'tax') row.withholding_tax -= amount;
    byDate.set(date,row);
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({...row,net:row.inflow-row.outflow}));
}

async function dayEvents(userId,accountId,date,currency = 'USD') {

  const rates = new Map();
  const rows = (await db.query('SELECT * FROM broker_cash_events WHERE user_id=$1 AND account_id=$2 AND event_date=$3 ORDER BY reference_id',[userId,accountId,date])).rows;
  const events = [];
  for (const row of rows) {
    const amount = row.currency === currency ? Number(row.amount) :
      (row.amount_usd != null ? Number(row.amount_usd) * await rateFor('USD',currency,date,rates) : Number(row.amount)*await rateFor(row.currency,currency,date,rates));
    events.push({id:row.id,transactionType:row.event_type,amount:Math.abs(amount),signedAmount:amount,
      description:row.description,sourceType:'ibkr',originalAmount:Number(row.amount),originalCurrency:row.currency});
  }
  return {events,tradeRate:await rateFor('USD',currency,date,rates)};
}
module.exports = {enrichCashflow,dayEvents};
