const db=require('../config/database');
const PlaidConnection=require('../models/PlaidConnection');
const {classifyIncome}=require('./plaid/plaidIncomeService');
const fx=require('../utils/currencyConverter');
const dateKey=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);

async function getIncomeSummary(userId,{startDate=null,endDate=null,currency='USD'}={}) {
  const broker=(await db.query(`SELECT e.*,a.account_name FROM broker_cash_events e
    JOIN user_accounts a ON a.id=e.account_id AND a.user_id=e.user_id
    WHERE e.user_id=$1 AND e.event_type IN ('dividend','interest','account_fee','tax')
    AND COALESCE(a.include_in_reports,true)=true AND COALESCE(a.is_archived,false)=false
    AND ($2::date IS NULL OR e.event_date >= $2) AND ($3::date IS NULL OR e.event_date <= $3)
    ORDER BY e.event_date,e.reference_id`,[userId,startDate,endDate])).rows;
  const fee=e=>['account_fee','tax'].includes(e.event_type);
  const records=broker.map(e=>({date:dateKey(e.event_date),currency:e.currency,
    category:fee(e)?'fee':e.event_type,value:Number(e.amount)*(fee(e)?-1:1),
    symbol:e.event_type==='dividend' && e.broker_type==='trading212' && e.description?.includes(': ')
      ? normalizeTicker(e.description.split(': ').slice(1).join(': ')) : `${e.account_name || e.broker_type} cash`}));
  if(await PlaidConnection.hasSchema()) {
    const plaid=(await db.query(`SELECT pt.*,pa.linked_account_id,COALESCE(ps.ticker_symbol,ps.name) AS symbol
      FROM plaid_transactions pt JOIN plaid_accounts pa ON pa.id=pt.plaid_account_row_id AND pa.user_id=pt.user_id
      LEFT JOIN plaid_securities ps ON ps.plaid_security_id=pt.raw_payload->>'security_id'
      LEFT JOIN user_accounts a ON a.id=pa.linked_account_id AND a.user_id=pt.user_id
      WHERE pt.user_id=$1 AND pt.transaction_source='investment' AND pt.is_removed=false
      AND COALESCE(a.include_in_reports,true)=true AND COALESCE(a.is_archived,false)=false
      AND ($2::date IS NULL OR pt.transaction_date >= $2) AND ($3::date IS NULL OR pt.transaction_date <= $3)
      ORDER BY pt.transaction_date`,[userId,startDate,endDate])).rows;
    // Prefer the broker payment when both connectors report the same linked
    // account, date, currency, category and signed wallet amount.
    const identities=new Set(broker.map(e=>[e.account_id,dateKey(e.event_date),e.currency,fee(e)?'fee':e.event_type,Number(e.amount)].join('|')));
    for(const e of plaid) {
      const category=classifyIncome(e.metadata?.investmentType,e.metadata?.investmentSubtype);
      if(!category) continue;
      const date=dateKey(e.transaction_date),sourceCurrency=e.iso_currency_code || 'USD';
      if(identities.has([e.linked_account_id,date,sourceCurrency,category,-Number(e.amount)].join('|'))) continue;
      records.push({date,currency:sourceCurrency,category,value:Number(e.amount)*(category==='fee'?1:-1),symbol:e.symbol || 'Account cash'});
    }
  }
  return aggregate(records,currency);
}
function normalizeTicker(value) {
  const london=String(value).match(/^(.+)l_EQ$/) || String(value).match(/^(.+)_GB_EQ$/i);
  return london?`${london[1].toUpperCase()}.L`:String(value).replace(/_US_EQ$/i,'').toUpperCase();
}
async function aggregate(records,currency) {
  const summary={totalDividends:0,totalInterest:0,totalFees:0,trailing12mDividends:0};
  const byMonth=new Map(),bySymbol=new Map(),rates=new Map();
  const cutoff=new Date();cutoff.setFullYear(cutoff.getFullYear()-1);
  const today=dateKey(new Date()),cutoffDate=dateKey(cutoff);
  for(const e of records) {
    if(!Number.isFinite(e.value)) throw Error('Invalid investment income amount');
    let rate=1;
    if(e.currency!==currency) {
      const key=`${e.currency}:${currency}:${e.date}`;
      if(!rates.has(key)) rates.set(key,await fx.getForexRate(e.currency,currency,e.date));
      rate=Number(rates.get(key));if(!(rate>0)) throw Error('Investment income currency conversion unavailable');
    }
    const value=e.value*rate,month=e.date.slice(0,7);
    const m=byMonth.get(month)||{month,dividends:0,interest:0,fees:0};
    const s=bySymbol.get(e.symbol)||{symbol:e.symbol,dividends:0,interest:0,fees:0,transactionCount:0,lastDate:null};
    const field={dividend:'dividends',interest:'interest',fee:'fees'}[e.category];if(!field) continue;
    m[field]+=value;s[field]+=value;s.transactionCount++;
    if(!s.lastDate || e.date>s.lastDate) s.lastDate=e.date;
    summary[{dividend:'totalDividends',interest:'totalInterest',fee:'totalFees'}[e.category]]+=value;
    if(e.category==='dividend' && e.date>=cutoffDate && e.date<=today) summary.trailing12mDividends+=value;
    byMonth.set(month,m);bySymbol.set(e.symbol,s);
  }
  const round=v=>Math.round((v+Number.EPSILON)*100)/100;
  for(const entry of [...byMonth.values(),...bySymbol.values()]) for(const key of ['dividends','interest','fees']) entry[key]=round(entry[key]);
  for(const key of Object.keys(summary)) summary[key]=round(summary[key]);
  return {currency,summary,byMonth:[...byMonth.values()].sort((a,b)=>a.month.localeCompare(b.month)),
    bySymbol:[...bySymbol.values()].sort((a,b)=>(b.dividends+b.interest)-(a.dividends+a.interest))};
}
module.exports={getIncomeSummary,aggregate};
