const db=require('../config/database');
const axios=require('axios');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');
const {assetCode,nativeWalletCode,decimal,format}=require('./brokerSync/krakenReconcile');
const {normalizeTicker,currentSymbol}=require('./brokerSync/trading212Instruments');
const {historySymbol,historySplits,historicalMarketSymbol}=require('./portfolioCorporateActions');
const {STABLE,FIAT}=require('./portfolioDashboardService');
const date=v=>new Date(v).toISOString().slice(0,10);
const days=(from,to)=>{const result=[];for(let t=Date.parse(from);t<=Date.parse(to);t+=86400000)result.push(date(t));return result;};
const latest=(rows,d)=>rows.filter(r=>r.date<=d).at(-1);

// Native ledger movements, including Earn wallet transfers and fees. Earn
// allocation summaries overlap these wallets and must never be added again.
function walletHistory(events,from,to) {
 const sorted=[...events].sort((a,b)=>a.time-b.time),balances=new Map(),result=[];let cursor=0;
 for(const d of days(from,to)) {
  while(cursor<sorted.length&&date(sorted[cursor].time)<=d) {
   const e=sorted[cursor++];balances.set(e.wallet,(balances.get(e.wallet)||0n)+decimal(e.amount)-decimal(e.fee||'0'));
  }
  const combined={};for(const [wallet,amount] of balances){const symbol=assetCode(wallet);combined[symbol]=(combined[symbol]||0)+Number(format(amount));}
  result.push({date:d,quantities:combined});
 }
 return result;
}

function historicalPrice(series,d,continuous=false) {
 const p=latest(series?.prices||[],d);
 // A previous exchange close covers weekends/holidays, never long outages.
 if(!p||Date.parse(d)-Date.parse(p.date)>(continuous?0:7)*86400000)return null;
 return p.close;
}

const estimatePrefix='Estimated at zero: missing historical price for ';
const priceIssue=(symbol,zeroMissingPrices)=>zeroMissingPrices?estimatePrefix+symbol:`Missing dated price: ${symbol}`;
const blocksValue=issues=>issues.some(issue=>!issue.startsWith(estimatePrefix));
function valueQuantities(quantities,d,price,fx,{zeroMissingPrices=false}={}) {
 let holdings=0,cash=0,stablecoins=0;const issues=[];
 for(const [symbol,q] of Object.entries(quantities)) {
  if(Math.abs(q)<1e-9)continue;
  if(q<0){issues.push(`Negative reconstructed quantity: ${symbol}`);continue;}
  const p=FIAT.has(symbol)?fx(symbol,d):price(symbol,d);
  if(!(p>0)){issues.push(priceIssue(symbol,zeroMissingPrices&&!FIAT.has(symbol)));continue;}
  if(FIAT.has(symbol))cash+=q*p;else if(STABLE.has(symbol))stablecoins+=q*p;else holdings+=q*p;
 }
 return {holdings_usd:blocksValue(issues)?null:holdings,cash_usd:blocksValue(issues)?null:cash,stablecoins_usd:blocksValue(issues)?null:stablecoins,issues};
}

// Yahoo daily closes are split-adjusted, not dividend-adjusted. Undo later
// splits so they value the actual number of shares owned on the historic day.
function parseYahoo(result) {
 const unit=normaliseMinorUnit(result?.meta?.currency);
 if(!unit)throw Error('Missing market-price currency');
 const splits=Object.values(result.events?.splits||{}).map(s=>({date:date(Number(s.date)*1000),ratio:Number(s.numerator)/Number(s.denominator)})).sort((a,b)=>a.date.localeCompare(b.date));
 if(splits.some(s=>!(s.ratio>0)))throw Error('Invalid split ratio');
 const quote=result.indicators?.quote?.[0];
 const prices=(result.timestamp||[]).flatMap((t,i)=>{
  const d=date(t*1000),close=quote?.close?.[i];
  if(!(close>0))return [];
  return [{date:d,close:close/unit.divisor*splits.filter(s=>s.date>d).reduce((p,s)=>p*s.ratio,1)}];
 });
 return {currency:unit.code,prices,splits,source:'Yahoo daily close; later splits reversed; minor units normalized'};
}

async function loadMarket(symbol,from,to,{fetchPrices=false}={}) {
 const cached=(await db.query('SELECT payload FROM portfolio_reconstruction_prices WHERE symbol=$1',[symbol])).rows[0]?.payload;
 if(cached&&cached.from<=from&&cached.to>=to)return cached;
 if(!fetchPrices)return cached||null;
 try {
  const response=await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,{
   params:{interval:'1d',period1:Math.floor(Date.parse(from)/1000)-7*86400,period2:Math.floor(Date.parse(to)/1000)+86400,events:'splits'},
   timeout:12000,maxRedirects:0,maxContentLength:8*1024*1024,headers:{'User-Agent':'TradeTally portfolio history'}});
  const payload={...parseYahoo(response.data.chart.result[0]),from,to};
  await db.query(`INSERT INTO portfolio_reconstruction_prices(symbol,payload) VALUES($1,$2) ON CONFLICT(symbol) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=NOW()`,[symbol,payload]);
  return payload;
 }catch{return null;} // Do not print request objects or broker credentials.
}

async function loadFx(from,to,{fetchPrices=false}={}) {
 let rows=(await db.query("SELECT rate_date,rates FROM fx_daily_rates WHERE base_code='USD' ORDER BY rate_date")).rows.map(r=>({date:date(r.rate_date),rates:r.rates}));
 if(fetchPrices) {
  try {
   const data=(await axios.get(`https://api.frankfurter.dev/v1/${from}..${to}?base=USD`,{timeout:30000,maxRedirects:0})).data;
   for(const [d,rates] of Object.entries(data.rates||{}))await db.query(`INSERT INTO fx_daily_rates(base_code,rate_date,source_date,rates,source) VALUES('USD',$1,$1,$2,'frankfurter') ON CONFLICT(base_code,rate_date) DO NOTHING`,[d,rates]);
   rows=(await db.query("SELECT rate_date,rates FROM fx_daily_rates WHERE base_code='USD' ORDER BY rate_date")).rows.map(r=>({date:date(r.rate_date),rates:r.rates}));
  }catch{/* Missing FX remains a gap, never use today's rate. */}
 }
 return (currency,d)=>{if(currency==='USD')return 1;const r=latest(rows,d);return r&&Date.parse(d)-Date.parse(r.date)<=7*86400000&&r.rates[currency]>0?1/Number(r.rates[currency]):null;};
}

function replayShares(fills,splits,from,to) {
 const events=[...fills.map(f=>({...f,kind:'fill'})),...splits.map(s=>({...s,kind:'split'}))].sort((a,b)=>a.date.localeCompare(b.date)||(a.kind==='split'?-1:1));
 const amounts={};let cursor=0;const result=[];
 for(const d of days(from,to)) {
  while(cursor<events.length&&events[cursor].date<=d){const e=events[cursor++];if(e.kind==='split')amounts[e.symbol]=(amounts[e.symbol]||0)*e.ratio;else amounts[e.symbol]=(amounts[e.symbol]||0)+e.quantity;}
  result.push({date:d,quantities:{...amounts}});
 }
 return result;
}

async function reconstruct(userId,{fetchPrices=false,apply=false,broker=null,zeroMissingPrices=false,onProgress=()=>{}}={}) {
 const accounts=(await db.query('SELECT * FROM user_accounts WHERE user_id=$1 AND is_archived=false AND account_identifier IS NOT NULL',[userId])).rows.filter(a=>!broker||a.broker===broker);
 if(!accounts.length)return [];
 const today=date(Date.now()),end=date(Date.now()-86400000),from=accounts.map(a=>date(a.initial_balance_date)).sort()[0];
 const fx=await loadFx(from,end,{fetchPrices});
 const krakenPayload=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='kraken' LIMIT 1",[userId])).rows[0]?.payload;
 const publicCryptoRates=krakenPayload?.valuation?.rates||{};
 let cryptoPairs=null;
 if(fetchPrices)try{cryptoPairs=(await axios.get('https://api.kraken.com/0/public/AssetPairs',{timeout:15000,maxRedirects:0})).data.result;}catch{/* Keep existing price coverage. */}
 const summaries=[];
 for(const account of accounts) {
  onProgress({broker:account.broker,stage:'reconstructing'});
  const start=date(account.initial_balance_date),identifier=account.account_identifier;
  const snapshot=(await db.query('SELECT * FROM broker_import_snapshots WHERE user_id=$1 AND broker_type=$2 AND account_identifier=$3',[userId,account.broker,identifier])).rows[0];
  const portfolio=(await db.query('SELECT * FROM broker_portfolio_snapshots WHERE user_id=$1 AND broker_type=$2 AND account_identifier=$3',[userId,account.broker,identifier])).rows[0];
  const trades=(await db.query('SELECT * FROM trades WHERE user_id=$1 AND broker=$2 AND account_identifier=$3',[userId,account.broker,identifier])).rows;
  let native=[],cashRows=[],cashOpening=Number(account.initial_balance||0),cutoff=end,method,blockers=[];
  const market=new Map(),cryptoRates=snapshot?.payload?.valuation?.rates||{},payload=snapshot?.payload;
  const need=new Set();
  let fills=[],splits=[];
  if(account.broker==='kraken') {
   if(!payload?.reconciled||!payload.nativeReconciliation?.nativeBalancesMatched)blockers.push('Native crypto ledger has not reconciled');
   native=walletHistory(Object.values(payload?.ledger||{}).map(l=>({wallet:nativeWalletCode(l.asset),time:Number(l.time)*1000,amount:l.amount,fee:l.fee})),start,end);
   for(const r of native)for(const [s,q] of Object.entries(r.quantities))if(Math.abs(q)>1e-9&&!FIAT.has(s))need.add(s+'-USD');
   cutoff=payload?.asOf?.slice(0,10)||start;
   method='Full native ledger including fees and Earn wallets; dated USD closes';
  }else if(account.broker==='okx') {
   if(!payload?.historyComplete||payload.funding?.length)blockers.push('Funding wallet history is incomplete');
   native=walletHistory((payload?.bills||[]).map(b=>({wallet:b.ccy,time:Number(b.ts),amount:b.balChg,fee:'0'})),start,end);
   const final=walletHistory((payload?.bills||[]).map(b=>({wallet:b.ccy,time:Number(b.ts),amount:b.balChg,fee:'0'})),start,today).at(-1)?.quantities||{};
   for(const p of payload?.trading?.[0]?.details||[])if(Math.abs((final[p.ccy]||0)-Number(p.cashBal))>1e-8)blockers.push(`Native crypto quantity mismatch: ${p.ccy}`);
   cutoff=payload?.asOf?.slice(0,10)||start;
   method='Reconciled Trading-wallet settlement bills; dated USD closes';
   for(const r of native)for(const [s,q] of Object.entries(r.quantities))if(Math.abs(q)>1e-9&&s!=='USDT')need.add(s+'-USD');
  }else {
   const ledgerService={ig:'igCashLedger',ibkr:'ibkrCashLedger',etoro:'etoroCashStatement',trading212:'trading212CashLedger'}[account.broker];
   const ledger=ledgerService?await require('./brokerSync/'+ledgerService).loadLedger(userId,account,start,end):null;
   if(!ledger)blockers.push('Complete native cash ledger is unavailable');
   else {
    cashRows=(ledger.rows||[]).map(r=>({date:date(r.date),balance:Number(r.balance)})).sort((a,b)=>a.date.localeCompare(b.date));
    cashOpening=Number(ledger.openingBalance??cashOpening);
    cutoff=ledger.report?date(ledger.report.to_date):ledger.reports?.at(-1)?.to_date||end;
    if(ledger.reconciliation&&ledger.reconciliation.matched===false)blockers.push('Cash ledger does not reconcile');
   }
   method='Dated native cash ledger plus historical security quantities and exchange closes';
   if(account.broker==='trading212') {
    const report=(await db.query("SELECT * FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='trading212' ORDER BY updated_at DESC LIMIT 1",[userId,account.id])).rows[0];
    const mapping=new Map((portfolio?.positions||[]).map(p=>[p.instrument.ticker,currentSymbol(p.instrument)]));
    fills=(report?.records||[]).map(r=>({date:r.date,symbol:historySymbol(mapping.get(r.symbol)||normalizeTicker(r.symbol),r.date),quantity:Number(r.quantity)*(r.side==='BUY'?1:-1)}));
    // Only an explicitly annotated subscription can create new shares. The
    // public prospectus supplies the issue price; native cash supplies units.
    // https://www.nationalgrid.com/document/152061/download (645p per share)
    const subscriptions=(await db.query("SELECT event_date,metadata FROM broker_cash_events WHERE user_id=$1 AND account_id=$2 AND broker_type='trading212' AND event_type='corporate_action' AND description='Deposit: rights issue executed (NG)'",[userId,account.id])).rows;
    for(const e of subscriptions)if(Number(e.metadata?.statement_annotation?.apiAmount)>0)fills.push({date:date(e.event_date),symbol:'NG.L',quantity:Number(e.metadata.statement_annotation.apiAmount)/6.45});
    fills.forEach(f=>need.add(f.symbol));
   }else {
    for(const t of trades)if(['stock','crypto'].includes(t.instrument_type))need.add(historicalMarketSymbol(t.symbol,t.instrument_type,date(t.entry_time||t.trade_date)));
   }
  }
  // Fetch public market prices only; never authenticated broker APIs or syncs.
  let processed=0;
  const symbols=[...need];
  let next=0;await Promise.all([0,1,2].map(async()=>{while(next<symbols.length){const s=symbols[next++];market.set(s,await loadMarket(s,start,today,{fetchPrices}));processed++;if(processed%40===0)onProgress({broker:account.broker,stage:'prices',processed,total:symbols.length});}}));
  if(account.broker==='kraken'&&fetchPrices&&cryptoPairs)for(const s of symbols) {
   const coin=s.slice(0,-4),pair=Object.entries(cryptoPairs).find(([,p])=>assetCode(p.base)===coin&&assetCode(p.quote)==='USD');
   if(!pair)continue;
   try {
    const response=(await axios.get('https://api.kraken.com/0/public/OHLC',{params:{pair:pair[0],interval:1440},timeout:15000,maxRedirects:0})).data;
    if(response.error?.length)continue;
    const prices=response.result?.[pair[0]]?.filter(c=>date(Number(c[0])*1000)<today).map(c=>({date:date(Number(c[0])*1000),close:Number(c[4])}));
    if(prices?.length){const series={currency:'USD',prices,splits:[],from:start,to:today,source:'Kraken daily UTC closes'};market.set(s,series);await db.query(`INSERT INTO portfolio_reconstruction_prices(symbol,payload) VALUES($1,$2) ON CONFLICT(symbol) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=NOW()`,[s,series]);}
   }catch{/* Preserve gaps when a public market is unavailable. */}
   await new Promise(resolve=>setTimeout(resolve,1100));
  }
  const stockPrice=(s,d)=>{const series=market.get(s),p=historicalPrice(series,d,s.endsWith('-USD'));return p>0&&fx(series.currency,d)>0?p*fx(series.currency,d):null;};
  let shareIssues=new Map();
  if(account.broker==='trading212') {
   for(const s of need)for(const split of historySplits(s,market.get(s)?.splits||[]))splits.push({...split,symbol:s});
   native=replayShares(fills,splits,start,end);
   const totals=replayShares(fills,splits,start,today).at(-1)?.quantities||{};
   const current=Object.fromEntries((portfolio?.positions||[]).map(p=>[currentSymbol(p.instrument),Number(p.quantity)]));
   for(const s of new Set([...Object.keys(totals),...Object.keys(current)]))if(Math.abs((totals[s]||0)-(current[s]||0))>0.0001)shareIssues.set(s,'Corporate-action quantity coverage requires reconciliation');
  }
  const rows=[];
  for(const d of days(start,end)) {
   let value={holdings_usd:0,cash_usd:0,stablecoins_usd:0,issues:[...blockers]};
   if(d>cutoff)value.issues.push('Beyond saved statement or sync coverage');
   if(['kraken','okx'].includes(account.broker)) {
    const quantities=native.find(r=>r.date===d)?.quantities||{};
    const price=(s,day)=>Number(cryptoRates[s]?.[day])||Number(publicCryptoRates[s]?.[day])||(s==='USDT'?Number(payload.rates?.[day])||null:stockPrice(s+'-USD',day));
    const crypto=valueQuantities(quantities,d,price,fx,{zeroMissingPrices});value={...crypto,issues:[...value.issues,...crypto.issues]};
   }else {
    const balance=latest(cashRows,d)?.balance??cashOpening,rate=fx(account.currency,d);
    if(!(rate>0))value.issues.push('Missing dated cash exchange rate');else value.cash_usd=balance*rate;
    if(account.broker==='trading212') {
     const quantities=native.find(r=>r.date===d)?.quantities||{};
     for(const [s,q] of Object.entries(quantities)) {
      if(Math.abs(q)<1e-8)continue;
      if(shareIssues.has(s)){value.issues.push(`${s}: ${shareIssues.get(s)}`);continue;}
      if(q<0){value.issues.push(`Negative reconstructed quantity: ${s}`);continue;}
      const p=stockPrice(s,d);if(!(p>0))value.issues.push(zeroMissingPrices?priceIssue(s,true):`Missing historical security value: ${s}`);else value.holdings_usd+=q*p;
     }
    }else {
     for(const t of trades) {
      const opened=date(t.entry_time||t.trade_date),closed=t.exit_time?date(t.exit_time):null;
      if(opened>d||(closed&&closed<=d))continue;
      if(!['stock','crypto'].includes(t.instrument_type)||t.side!=='long') {value.issues.push(`Historical derivative valuation unavailable: ${t.symbol}`);continue;}
      const s=historicalMarketSymbol(t.symbol,t.instrument_type,opened),series=market.get(s);
      // Statement lot quantities may be adjusted to a later split. Without a
      // dated broker split allocation, avoid claiming a pre-split valuation.
      if((series?.splits||[]).some(x=>x.date>opened&&(!closed||x.date<closed)&&(closed||x.date>d))){value.issues.push(`Historic split allocation unavailable: ${t.symbol}`);continue;}
      const p=stockPrice(s,d);if(!(p>0))value.issues.push(priceIssue(t.symbol,zeroMissingPrices));
      else if(t.instrument_type==='crypto'&&STABLE.has(t.symbol))value.stablecoins_usd+=Number(t.quantity)*p;
      else value.holdings_usd+=Number(t.quantity)*p;
     }
    }
   }
   value.issues=[...new Set(value.issues)];
   if(blocksValue(value.issues))value.holdings_usd=value.cash_usd=value.stablecoins_usd=null;
   rows.push({...value,date:d,gbp_per_usd:fx('GBP',d)>0?1/fx('GBP',d):null});
  }
  if(apply)await db.withTransaction(async client=>{
   await client.query('DELETE FROM portfolio_reconstructed_values WHERE user_id=$1 AND account_identifier=$2',[userId,identifier]);
   for(const r of rows)await client.query(`INSERT INTO portfolio_reconstructed_values(user_id,account_identifier,value_date,holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd,issues,method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[userId,identifier,r.date,r.holdings_usd,r.cash_usd,r.stablecoins_usd,r.gbp_per_usd,JSON.stringify(r.issues),method]);
  });
  const valid=rows.filter(r=>r.holdings_usd!=null);
  summaries.push({broker:account.broker,days:valid.length,estimatedDays:valid.filter(r=>r.issues.length).length,first:valid[0]?.date,last:valid.at(-1)?.date,gaps:rows.length-valid.length,issues:[...new Set(rows.flatMap(r=>r.issues))]});
  onProgress({broker:account.broker,stage:'complete',days:valid.length,gaps:rows.length-valid.length});
 }
 return summaries;
}
module.exports={reconstruct,walletHistory,historicalPrice,valueQuantities,parseYahoo,replayShares};
