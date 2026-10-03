const db=require('../config/database');
const Portfolio=require('./portfolioService');
const Account=require('../models/Account');
const {getRatesToDisplay}=require('../utils/displayCurrency');
const {parseReportDateRange}=require('../utils/reportDateRange');
const {STABLE,FIAT}=require('./portfolioDashboardService');
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const money=v=>Math.round(v*100)/100;
const pending=new Map();

async function accountsFor(userId,query={}) {
  const requested=String(query.accounts||'').split(',').map(x=>x.trim()).filter(Boolean);
  const rows=(await db.query(`SELECT id,account_identifier,account_name,broker,currency,initial_balance_date
    FROM user_accounts WHERE user_id=$1 AND is_archived=false AND account_identifier IS NOT NULL`,[userId])).rows;
  if(requested.some(identifier=>!rows.some(a=>a.account_identifier===identifier))) {
    const error=Error('One or more selected accounts are unavailable');error.status=400;throw error;
  }
  return rows.filter(a=>!requested.length||requested.includes(a.account_identifier));
}

async function captureToday(userId,query={}) {
  const accounts=await accountsFor(userId,query);
  const key=userId+':'+accounts.map(a=>a.account_identifier).sort().join(',');
  if(pending.has(key))return pending.get(key);
  const job=(async()=>{
    const today=new Date().toISOString().slice(0,10);
    const fx=await getRatesToDisplay(['USD',...accounts.map(a=>a.currency)],'USD');
    const gbp=await getRatesToDisplay(['USD'],'GBP');
    let captured=0,unavailable=0;
    for(const account of accounts) {
      const positions=(await Portfolio.getPositions(userId,{accounts:account.account_identifier}))
        .filter(p=>!(p.instrumentType==='crypto'&&FIAT.has(p.symbol)));
      const flow=account.broker==='okx'?null:await Account.getCashflow(userId,account.id);
      const live=flow?.summary?.liveCashBalance;
      const cash=account.broker==='okx'?0:live?.amount??flow?.summary?.currentBalance;
      const currency=live?.currency||account.currency;
      if(positions.some(p=>!Number.isFinite(p.currentValue)) || !Number.isFinite(cash) ||
        !(fx[currency]>0) || (account.broker!=='okx' && (!flow || flow.summary.cashflowSource==='trade_history'))) {
        unavailable++;continue;
      }
      const stable=positions.filter(p=>p.instrumentType==='crypto'&&STABLE.has(p.symbol));
      const stableValue=stable.reduce((sum,p)=>sum+p.currentValue,0);
      const holdings=positions.reduce((sum,p)=>sum+p.currentValue,0)-stableValue;
      await db.query(`INSERT INTO portfolio_value_history(user_id,account_identifier,value_date,
        holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd,stale_prices)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(user_id,account_identifier,value_date) DO UPDATE SET
          holdings_usd=EXCLUDED.holdings_usd,cash_usd=EXCLUDED.cash_usd,
          stablecoins_usd=EXCLUDED.stablecoins_usd,gbp_per_usd=EXCLUDED.gbp_per_usd,
          stale_prices=EXCLUDED.stale_prices,recorded_at=NOW()`,
      [userId,account.account_identifier,today,holdings,cash*fx[currency],stableValue,gbp.USD||null,positions.filter(p=>p.priceStale).length]);
      captured++;
    }
    return {captured,unavailable,date:today};
  })();
  pending.set(key,job);
  try{return await job;}finally{pending.delete(key);}
}

// All selected accounts must be present on a day. Missing observations are
// explicit gaps, never zero balances or a carry-forward estimate.
function combineValues(rows,accounts,currency) {
  const dates=[...new Set(rows.map(r=>day(r.value_date)))].sort();
  return dates.map(date=>{
    const active=accounts.filter(a=>!a.initial_balance_date||day(a.initial_balance_date)<=date);
    const values=active.map(a=>rows.find(r=>day(r.value_date)===date&&r.account_identifier===a.account_identifier));
    const missing=values.filter(r=>!r || (currency==='GBP'&&!(Number(r.gbp_per_usd)>0))).length;
    if(missing||!active.length)return {date,value:null,missingAccounts:missing,stalePrices:0};
    let total=0,holdings=0,cash=0,stablecoins=0,stalePrices=0;
    for(const r of values) {
      const rate=currency==='USD'?1:Number(r.gbp_per_usd);
      holdings+=Number(r.holdings_usd)*rate;cash+=Number(r.cash_usd)*rate;stablecoins+=Number(r.stablecoins_usd)*rate;
      stalePrices+=Number(r.stale_prices||0);
    }
    total=holdings+cash+stablecoins;
    return {date,value:money(total),holdings:money(holdings),cash:money(cash),stablecoins:money(stablecoins),missingAccounts:0,stalePrices};
  });
}

async function getHistory(userId,query={}) {
  const range=parseReportDateRange(query),currency=query.currency||'GBP';
  if(!['GBP','USD'].includes(currency)){const e=Error('Choose GBP or USD');e.status=400;throw e;}
  const accounts=await accountsFor(userId,query);
  const identifiers=accounts.map(a=>a.account_identifier);
  const rows=(await db.query(`SELECT * FROM portfolio_value_history WHERE user_id=$1 AND account_identifier=ANY($2)
    AND ($3::date IS NULL OR value_date>=$3) AND ($4::date IS NULL OR value_date<=$4) ORDER BY value_date`,
  [userId,identifiers,range?.start_date||null,range?.end_date||null])).rows;
  const pairs=(await db.query('SELECT * FROM broker_transfer_matches WHERE user_id=$1',[userId])).rows;
  const fxRows=(await db.query("SELECT rate_date,base_code,rates FROM fx_daily_rates WHERE base_code IN ('USD','GBP')")).rows;
  const fx=new Map(fxRows.flatMap(r=>Object.entries(r.rates).map(([quote,rate])=>[`${day(r.rate_date)}:${r.base_code}:${quote}`,Number(rate)])));
  const events=[],unavailableAccounts=[];
  for(const account of accounts) {
    const flow=await Account.getCashflow(userId,account.id,{startDate:range?.start_date,endDate:range?.end_date});
    if(!flow){unavailableAccounts.push(account.account_name);continue;}
    for(const row of flow.cashflow||[]) {
      const date=day(row.date);
      const internal=pairs.filter(p=>identifiers.includes(p.source_account)&&identifiers.includes(p.destination_account)&&p.asset===account.currency);
      const outgoing=internal.filter(p=>p.source_account===account.account_identifier&&day(p.sent_at)===date).reduce((s,p)=>s+Number(p.quantity),0);
      const incoming=internal.filter(p=>p.destination_account===account.account_identifier&&day(p.received_at)===date).reduce((s,p)=>s+Number(p.quantity),0);
      const movements=[['deposit',Number(row.deposits||0)],['withdrawal',-Number(row.withdrawals||0)],
        ['transfer',Math.max(0,Number(row.transferIn||0)-incoming)-Math.max(0,Number(row.transferOut||0)-outgoing)]];
      for(const [type,amount] of movements) {
        if(Math.abs(amount)<.005)continue;
        const rate=account.currency===currency?1:fx.get(`${date}:${account.currency}:${currency}`)||
          (fx.get(`${date}:${currency}:${account.currency}`)>0?1/fx.get(`${date}:${currency}:${account.currency}`):null);
        events.push({date,type,amount:rate>0?money(amount*rate):null,nativeAmount:money(amount),nativeCurrency:account.currency,account:account.account_name});
      }
    }
  }
  const series=combineValues(rows,accounts,currency);
  const valid=series.filter(p=>p.value!=null);
  return {currency,range,series,events:events.sort((a,b)=>a.date.localeCompare(b.date)),accountCount:accounts.length,
    coverage:{firstValueDate:valid[0]?.date||null,lastValueDate:valid.at(-1)?.date||null,recordedDays:valid.length,
      partialDays:series.filter(p=>p.value==null).length,missingEventFx:events.filter(e=>e.amount==null).length,
      unavailableAccounts,cryptoTransfersIncluded:false},
    change:valid.length>=2?money(valid.at(-1).value-valid[0].value):null};
}

async function captureAllUsers() {
  const users=(await db.query('SELECT id FROM users')).rows;
  for(const user of users)await captureToday(user.id);
}
module.exports={captureToday,getHistory,combineValues,captureAllUsers};
