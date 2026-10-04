const db=require('../config/database');
const Portfolio=require('./portfolioService');
const Account=require('../models/Account');
const {getRatesToDisplay}=require('../utils/displayCurrency');
const {parseReportDateRange}=require('../utils/reportDateRange');
const {STABLE,FIAT}=require('./portfolioDashboardService');
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const money=v=>Math.round(v*100)/100;
function fundingFx(fx,date,base,quote){
  if(base===quote)return {rate:1,sourceDate:date}
  for(let offset=0;offset<=7;offset++){
    const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-offset)
    const sourceDate=d.toISOString().slice(0,10)
    const direct=fx.get(`${sourceDate}:${base}:${quote}`),inverse=fx.get(`${sourceDate}:${quote}:${base}`)
    if(direct>0)return {rate:direct,sourceDate}
    if(inverse>0)return {rate:1/inverse,sourceDate}
  }
  return {rate:null,sourceDate:null}
}
const pending=new Map();
const {carryForward}=require('./statementPortfolioCarryForward');

async function accountsFor(userId,query={}) {
  const requested=String(query.accounts||'').split(',').map(x=>x.trim()).filter(Boolean);
  const rows=(await db.query(`SELECT id,account_identifier,account_name,broker,currency,initial_balance_date,
    EXISTS(SELECT 1 FROM broker_import_snapshots s WHERE s.user_id=user_accounts.user_id
      AND s.account_identifier=user_accounts.account_identifier AND s.broker_type='ig'
      AND s.payload->'igFileInput'->>'kind'='spread_bet') AS is_ig_spread
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
    const warnings=[];
    for(const account of accounts) {
      // IG has no live API valuation. An old imported balance is not a new
      // observation today; history instead displays a labelled carry-forward.
      if(account.broker==='ig'){unavailable++;continue;}
      if(account.broker==='ibkr') {
        const nav=(await db.query(`SELECT MAX(value_date) AS latest FROM portfolio_statement_values
          WHERE user_id=$1 AND account_identifier=$2`,[userId,account.account_identifier])).rows[0]?.latest;
        if(!nav||Date.now()-Date.parse(day(nav))>4*86400000){unavailable++;warnings.push('ibkr: a recent dated NAV statement is unavailable; the chart retains previous values.');}
        continue;
      }
      let brokerSnapshot=null;
      if(['trading212','kraken','okx'].includes(account.broker)) {
        brokerSnapshot=(await db.query(`SELECT * FROM broker_portfolio_snapshots WHERE user_id=$1 AND broker_type=$2 AND account_identifier=$3`,[userId,account.broker,account.account_identifier])).rows[0];
        const age=brokerSnapshot?Date.now()-new Date(brokerSnapshot.synced_at).getTime():Infinity;
        if(!Number.isFinite(age)||age< -300000||age>36*3600000) {
          unavailable++;warnings.push(`${account.broker}: current portfolio snapshot is missing or older than 36 hours; no fresh chart value was recorded.`);continue;
        }
        if(day(brokerSnapshot.synced_at)!==today) {
          unavailable++;warnings.push(`${account.broker}: the latest broker snapshot is not from today; previous dated chart values were retained.`);continue;
        }
        if(account.broker==='kraken') {
          const imported=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='kraken' AND account_identifier=$2",[userId,account.account_identifier])).rows[0]?.payload;
          if(!imported?.reconciled||!imported.nativeReconciliation?.nativeBalancesMatched){unavailable++;warnings.push('kraken: portfolio capture awaits native balance reconciliation.');continue;}
        } else if(account.broker==='trading212') {
          const report=(await db.query("SELECT to_date FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='trading212' ORDER BY updated_at DESC LIMIT 1",[userId,account.id])).rows[0];
          if(!report||day(report.to_date)!==day(brokerSnapshot.synced_at)){unavailable++;warnings.push('trading212: cash and holdings dates do not match; no fresh chart value was recorded.');continue;}
        }
      }
      if(account.broker==='okx') {
        const imported=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='okx' AND account_identifier=$2",[userId,account.account_identifier])).rows[0]?.payload;
        if(!imported?.historyComplete||imported.funding?.length||imported.positions?.length){unavailable++;warnings.push('okx: spot history has not reconciled; no fresh chart value was recorded.');continue;}
      }
      const rawPositions=brokerSnapshot?
        (await require('./brokerSync/portfolioSnapshot').snapshotPositions([brokerSnapshot])).map(p=>({...p,currentValue:p.totalShares*p.brokerCurrentPrice,priceStale:false})):
        await Portfolio.getPositions(userId,{accounts:account.account_identifier});
      const positions=rawPositions
        .filter(p=>!(p.instrumentType==='crypto'&&FIAT.has(p.symbol)));
      const flow=account.broker==='okx'?null:await Account.getCashflow(userId,account.id);
      const live=flow?.summary?.liveCashBalance;
      const cash=account.broker==='okx'?0:live?.amount??flow?.summary?.currentBalance;
      const currency=live?.currency||account.currency;
      const cashAge=Date.now()-Date.parse(live?.asOf);
      if(flow?.summary?.reconciliation?.matched===false ||
        (account.broker==='kraken'&&(!Number.isFinite(cashAge)||cashAge< -300000||cashAge>36*3600000))) {
        unavailable++;warnings.push(`${account.broker}: cash valuation is stale or has not reconciled; no fresh chart value was recorded.`);continue;
      }
      if((!brokerSnapshot&&positions.some(p=>!Number.isFinite(p.currentValue))) || !Number.isFinite(cash) ||
        !(fx[currency]>0) || (account.broker!=='okx' && (!flow || flow.summary.cashflowSource==='trade_history'))) {
        unavailable++;warnings.push(`${account.broker}: portfolio prices, cash history or currency conversion are incomplete; no fresh chart value was recorded.`);continue;
      }
      const stable=positions.filter(p=>p.instrumentType==='crypto'&&STABLE.has(p.symbol));
      const stableValue=stable.reduce((sum,p)=>sum+p.currentValue,0);
      const holdings=positions.reduce((sum,p)=>sum+p.currentValue,0)-stableValue;
      let capturedHoldings=holdings,capturedStable=stableValue;
      // Use the reconciled broker wallet valuation, rather than asynchronously
      // refreshed provider quotes whose timestamps can differ from the cash.
      if(brokerSnapshot) {
        const brokerPositions=rawPositions;
        if(brokerPositions.some(p=>!Number.isFinite(p.brokerCurrentPrice)||!Number.isFinite(p.totalShares))) {
          unavailable++;warnings.push(`${account.broker}: broker portfolio valuation is incomplete.`);continue;
        }
        capturedStable=brokerPositions.filter(p=>p.instrumentType==='crypto'&&STABLE.has(p.symbol)).reduce((s,p)=>s+p.totalShares*p.brokerCurrentPrice,0);
        capturedHoldings=brokerPositions.filter(p=>!(p.instrumentType==='crypto'&&(STABLE.has(p.symbol)||FIAT.has(p.symbol)))).reduce((s,p)=>s+p.totalShares*p.brokerCurrentPrice,0);
      } else if(positions.some(p=>!Number.isFinite(Date.parse(p.priceAsOf))||Date.now()-Date.parse(p.priceAsOf)>36*3600000)) {
        unavailable++;warnings.push(`${account.broker}: market prices are missing or older than 36 hours.`);continue;
      }
      await db.query(`INSERT INTO portfolio_value_history(user_id,account_identifier,value_date,
        holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd,stale_prices)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(user_id,account_identifier,value_date) DO UPDATE SET
          holdings_usd=EXCLUDED.holdings_usd,cash_usd=EXCLUDED.cash_usd,
          stablecoins_usd=EXCLUDED.stablecoins_usd,gbp_per_usd=EXCLUDED.gbp_per_usd,
          stale_prices=EXCLUDED.stale_prices,recorded_at=NOW()`,
      [userId,account.account_identifier,today,capturedHoldings,cash*fx[currency],capturedStable,gbp.USD||null,brokerSnapshot?0:positions.filter(p=>p.priceStale).length]);
      captured++;
    }
    return {captured,unavailable,date:today,warnings};
  })();
  pending.set(key,job);
  try{return await job;}finally{pending.delete(key);}
}

// All selected accounts must be present on a day. Missing observations are
// explicit gaps unless the manual-import overlay supplies labelled estimates.
function combineValues(rows,accounts,currency) {
  const dates=[...new Set(rows.map(r=>day(r.value_date)))].sort();
  const index=new Map(rows.map(r=>[`${day(r.value_date)}:${r.account_identifier}`,r]));
  return dates.map(date=>{
    const active=accounts.filter(a=>!a.initial_balance_date||day(a.initial_balance_date)<=date);
    const values=active.map(a=>index.get(`${date}:${a.account_identifier}`));
    const missing=values.filter(r=>!r || r.holdings_usd==null || r.cash_usd==null || r.stablecoins_usd==null || (currency==='GBP'&&!(Number(r.gbp_per_usd)>0))).length;
    if(missing||!active.length)return {date,value:null,missingAccounts:missing,stalePrices:0};
    let total=0,holdings=0,cash=0,stablecoins=0,stalePrices=0;
    for(const r of values) {
      const rate=currency==='USD'?1:Number(r.gbp_per_usd);
      holdings+=Number(r.holdings_usd)*rate;cash+=Number(r.cash_usd)*rate;stablecoins+=Number(r.stablecoins_usd)*rate;
      stalePrices+=Number(r.stale_prices||0);
    }
    total=holdings+cash+stablecoins;
    return {date,value:money(total),holdings:money(holdings),cash:money(cash),stablecoins:money(stablecoins),missingAccounts:0,stalePrices,
      reconstructedAccounts:values.filter(r=>r.source==='reconstructed').length,
      estimatedAccounts:values.filter(r=>r.source==='reconstructed'&&(r.issues||[]).some(i=>i.startsWith('Estimated at zero:'))).length,
      migrationEstimatedAccounts:values.filter(r=>r.source==='reconstructed'&&(r.issues||[]).some(i=>i.startsWith('Estimated using 1:1 token migration:'))).length,
      statementEstimatedAccounts:values.filter(r=>r.source==='reconstructed'&&(r.issues||[]).some(i=>i.startsWith('Estimated using previous IBKR statement:'))).length,
      manualCarryForwardAccounts:values.filter(r=>r.carryForwardFrom).length,
      carryForwardBalances:values.filter(r=>r.carryForwardFrom).map(r=>({account:accounts.find(a=>a.account_identifier===r.account_identifier)?.account_name,from:r.carryForwardFrom})),
      igCarryForwardAccounts:values.filter(r=>(r.issues||[]).some(i=>i.startsWith('Estimated using previous IG balance:'))).length};
  });
}

async function getHistory(userId,query={}) {
  const range=parseReportDateRange(query),currency=query.currency||'GBP';
  if(!['GBP','USD'].includes(currency)){const e=Error('Choose GBP or USD');e.status=400;throw e;}
  const accounts=await accountsFor(userId,query);
  const identifiers=accounts.map(a=>a.account_identifier);
  let rows=(await db.query(`SELECT * FROM (
    SELECT user_id,account_identifier,value_date,holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd,stale_prices,
      'recorded' AS source,'[]'::jsonb AS issues FROM portfolio_value_history o
    WHERE NOT EXISTS(SELECT 1 FROM user_accounts a WHERE a.user_id=o.user_id AND a.account_identifier=o.account_identifier AND a.broker IN ('ig','ibkr'))
      AND NOT EXISTS(SELECT 1 FROM portfolio_statement_values s WHERE s.user_id=o.user_id AND s.account_identifier=o.account_identifier AND s.value_date=o.value_date)
    UNION ALL
    SELECT s.user_id,s.account_identifier,s.value_date,s.holdings_usd,s.cash_usd,s.stablecoins_usd,s.gbp_per_usd,0,
      'statement' AS source,'[]'::jsonb AS issues FROM portfolio_statement_values s
    UNION ALL
    SELECT r.user_id,r.account_identifier,r.value_date,r.holdings_usd,r.cash_usd,r.stablecoins_usd,r.gbp_per_usd,0,
      'reconstructed' AS source,r.issues FROM portfolio_reconstructed_values r
    WHERE (NOT EXISTS(SELECT 1 FROM portfolio_value_history o WHERE o.user_id=r.user_id AND o.account_identifier=r.account_identifier AND o.value_date=r.value_date)
      OR EXISTS(SELECT 1 FROM user_accounts a WHERE a.user_id=r.user_id AND a.account_identifier=r.account_identifier AND a.broker IN ('ig','ibkr')))
      AND NOT EXISTS(SELECT 1 FROM portfolio_statement_values s WHERE s.user_id=r.user_id AND s.account_identifier=r.account_identifier AND s.value_date=r.value_date)
    ) history WHERE user_id=$1 AND account_identifier=ANY($2) ORDER BY value_date`,
  [userId,identifiers])).rows;
  const pairs=(await db.query('SELECT * FROM broker_transfer_matches WHERE user_id=$1',[userId])).rows;
  const fxRows=(await db.query("SELECT rate_date,base_code,rates FROM fx_daily_rates WHERE base_code IN ('USD','GBP')")).rows;
  const igRates=new Map(fxRows.filter(r=>r.base_code==='USD'&&Number(r.rates.GBP)>0).map(r=>[day(r.rate_date),Number(r.rates.GBP)]));
  for(const r of fxRows.filter(r=>r.base_code==='GBP'&&Number(r.rates.USD)>0))if(!igRates.has(day(r.rate_date)))igRates.set(day(r.rate_date),1/Number(r.rates.USD));
  // Ignore legacy IG page captures: these reused imported cash with no live
  // equity valuation. Actual statements and reconstructed daily values win.
  rows=rows.filter(r=>!(r.source==='recorded'&&accounts.some(a=>['ig','ibkr'].includes(a.broker)&&a.account_identifier===r.account_identifier)));
  const today=new Date().toISOString().slice(0,10);
  rows=carryForward(rows,accounts,igRates,today).filter(r=>(!range||day(r.value_date)>=range.start_date&&day(r.value_date)<=range.end_date));
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
        const {rate,sourceDate}=fundingFx(fx,date,account.currency,currency);
        events.push({date,type,amount:rate>0?money(amount*rate):null,nativeAmount:money(amount),nativeCurrency:account.currency,account:account.account_name,fxSourceDate:sourceDate});
      }
    }
  }
  const series=combineValues(rows,accounts,currency);
  const valid=series.filter(p=>p.value!=null);
  return {currency,range,series,events:events.sort((a,b)=>a.date.localeCompare(b.date)),accountCount:accounts.length,
    coverage:{firstValueDate:valid[0]?.date||null,lastValueDate:valid.at(-1)?.date||null,recordedDays:valid.length,
      reconstructedDays:valid.filter(p=>p.reconstructedAccounts>0).length,
      estimatedDays:valid.filter(p=>p.estimatedAccounts>0).length,
      migrationEstimatedDays:valid.filter(p=>p.migrationEstimatedAccounts>0).length,
      statementEstimatedDays:valid.filter(p=>p.statementEstimatedAccounts>0).length,
      igCarryForwardDays:valid.filter(p=>p.igCarryForwardAccounts>0).length,
      manualCarryForwardDays:valid.filter(p=>p.manualCarryForwardAccounts>0).length,
      accounts:accounts.map(a=>{const own=rows.filter(r=>r.account_identifier===a.account_identifier);const complete=own.filter(r=>r.holdings_usd!=null&&(currency==='USD'||Number(r.gbp_per_usd)>0));return {name:a.account_name,days:complete.length,firstDate:complete[0]?day(complete[0].value_date):null,lastDate:complete.at(-1)?day(complete.at(-1).value_date):null,issues:[...new Set(own.flatMap(r=>r.issues||[]))]};}),
      partialDays:series.filter(p=>p.value==null).length,missingEventFx:events.filter(e=>e.amount==null).length,
      unavailableAccounts,cryptoTransfersIncluded:false},
    change:valid.length>=2?money(valid.at(-1).value-valid[0].value):null};
}

async function captureAllUsers() {
  const users=(await db.query('SELECT id FROM users')).rows;
  for(const user of users)await captureToday(user.id);
}
module.exports={captureToday,getHistory,combineValues,captureAllUsers,fundingFx};
