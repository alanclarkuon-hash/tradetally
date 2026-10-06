const db=require('../config/database');
const axios=require('axios');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');
const {assetCode,nativeWalletCode,decimal,format,category}=require('./brokerSync/krakenReconcile');
const {normalizeTicker,currentSymbol}=require('./brokerSync/trading212Instruments');
const {historySymbol,historySplits,historicalMarketSymbol}=require('./portfolioCorporateActions');
const {statementSplits,historicalLotQuantity,statementLotMetadata}=require('./etoroHistoricalSplits');
const {cfdEquity}=require('./etoroHistoricalCfd');
const {STABLE,FIAT}=require('./portfolioDashboardService');
const date=v=>new Date(v).toISOString().slice(0,10);
const days=(from,to)=>{const result=[];for(let t=Date.parse(from);t<=Date.parse(to);t+=86400000)result.push(date(t));return result;};
const latest=(rows,d)=>rows.filter(r=>r.date<=d).at(-1);

// A conversion-day predecessor close is valid only for a uniquely paired,
// recorded 1:1 migration. Never rename balances before the native conversion.
function migrationPriceAliases(ledger) {
 const rows=Object.values(ledger||{}).filter(l=>category(l)==='asset_conversion');
 const aliases=new Map(),migrations={FTM:'S',EOS:'A'};
 for(const out of rows) {
  const symbol=assetCode(out.asset),target=migrations[symbol],amount=decimal(out.amount)-decimal(out.fee||'0');
  if(!target||amount>=0n)continue;
  const matches=rows.filter(l=>assetCode(l.asset)===target&&decimal(l.amount)-decimal(l.fee||'0')===-amount&&Math.abs(Number(l.time)-Number(out.time))<172800);
  if(matches.length===1&&rows.filter(l=>assetCode(l.asset)===symbol&&decimal(l.amount)-decimal(l.fee||'0')===amount&&Math.abs(Number(l.time)-Number(matches[0].time))<172800).length===1)
   aliases.set(`${target}:${date(Number(matches[0].time)*1000)}`,symbol);
 }
 return aliases;
}

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
const migrationEstimatePrefix='Estimated using 1:1 token migration: ';
const blocksValue=issues=>issues.some(issue=>!issue.startsWith(estimatePrefix)&&!issue.startsWith(migrationEstimatePrefix));
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

async function loadMarket(symbol,from,to,{fetchPrices=false,userId=null}={}) {
 const cached=(await db.query('SELECT payload FROM portfolio_reconstruction_prices WHERE symbol=$1',[symbol])).rows[0]?.payload;
 if(symbol.endsWith('-USD')) {
  const coin=symbol.slice(0,-4);
  const rows=fetchPrices&&userId?await require('./portfolioService')._getDailySeries(coin,from,to,userId,{instrumentType:'crypto'}):await require('../utils/historicalPriceCache').getRange('CRYPTO:'+coin,from,to);
  const prices=new Map((cached?.prices||[]).map(p=>[p.date,p]));
  for(const c of rows){const d=date(c.time*1000);if(!prices.has(d))prices.set(d,{date:d,close:c.close});}
  if(prices.size){const payload={...cached,currency:'USD',prices:[...prices.values()].sort((a,b)=>a.date.localeCompare(b.date)),splits:[],from:cached?.from<from?cached.from:from,to:cached?.to>to?cached.to:to,source:'Shared broker/provider historical USD prices'};
   if(fetchPrices)await db.query(`INSERT INTO portfolio_reconstruction_prices(symbol,payload) VALUES($1,$2) ON CONFLICT(symbol) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=NOW()`,[symbol,payload]);
   return payload;
  }
  return cached||null;
 }
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

async function reconstruct(userId,{fetchPrices=false,apply=false,broker=null,accountIdentifiers=null,fromDate=null,zeroMissingPrices=false,onProgress=()=>{}}={}) {
 const accounts=(await db.query('SELECT * FROM user_accounts WHERE user_id=$1 AND is_archived=false AND account_identifier IS NOT NULL',[userId])).rows.filter(a=>(!broker||a.broker===broker)&&(!accountIdentifiers||accountIdentifiers.includes(a.account_identifier)));
 if(!accounts.length)return [];
 const today=date(Date.now()),end=date(Date.now()-86400000),from=accounts.map(a=>date(a.initial_balance_date)).sort()[0];
 const fx=await loadFx(from,end,{fetchPrices});
 const krakenPayload=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='kraken' LIMIT 1",[userId])).rows[0]?.payload;
 const publicCryptoRates=krakenPayload?.valuation?.rates||{};

 const summaries=[];
 for(const account of accounts) {
  onProgress({broker:account.broker,stage:'reconstructing'});
  const start=date(account.initial_balance_date),identifier=account.account_identifier;
  const snapshot=(await db.query('SELECT * FROM broker_import_snapshots WHERE user_id=$1 AND broker_type=$2 AND account_identifier=$3',[userId,account.broker,identifier])).rows[0];
  const portfolio=(await db.query('SELECT * FROM broker_portfolio_snapshots WHERE user_id=$1 AND broker_type=$2 AND account_identifier=$3',[userId,account.broker,identifier])).rows[0];
  const trades=(await db.query('SELECT * FROM trades WHERE user_id=$1 AND broker=$2 AND account_identifier=$3',[userId,account.broker,identifier])).rows;
  let native=[],cashRows=[],cashOpening=Number(account.initial_balance||0),cutoff=end,method,blockers=[];
  const market=new Map(),cryptoRates=snapshot?.payload?.valuation?.rates||{},payload=snapshot?.payload;
  const marketSymbolFor=t=>account.broker==='etoro'&&t.instrument_type!=='crypto'&&etoroLots.get(t)?.marketSymbol?
   historySymbol(etoroLots.get(t).marketSymbol,date(t.entry_time||t.trade_date)):historicalMarketSymbol(t.symbol,t.instrument_type,date(t.entry_time||t.trade_date));
  const need=new Set();
  let fills=[],splits=[],etoroSplits=[],etoroLots=new Map();
  if(account.broker==='etoro') {
   const reports=(await db.query("SELECT records FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='etoro'",[userId,account.id])).rows;
   const records=reports.flatMap(r=>r.records||[]);
   etoroSplits=statementSplits(records);
   etoroLots=statementLotMetadata(trades,records,etoroSplits);
  }
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
    for(const t of trades)if(['stock','crypto'].includes(t.instrument_type)||(account.broker==='etoro'&&t.instrument_type==='cfd'))need.add(marketSymbolFor(t));
   }
  }
  // Fetch public market prices only; never authenticated broker APIs or syncs.
  let processed=0;
  const symbols=[...need];
  let next=0;await Promise.all([0,1,2].map(async()=>{while(next<symbols.length){const s=symbols[next++];market.set(s,await loadMarket(s,start,end,{fetchPrices,userId}));processed++;if(processed%40===0)onProgress({broker:account.broker,stage:'prices',processed,total:symbols.length});}}));
  const stockPrice=(s,d)=>{const series=market.get(s),p=historicalPrice(series,d,s.endsWith('-USD'));return p>0&&fx(series.currency,d)>0?p*fx(series.currency,d):null;};
  // Retired markets may have disappeared from live pair metadata. Their
  // official daily archive retains actual historical closes.
  if(account.broker==='kraken'&&fetchPrices)for(const s of symbols) {
   const coin=s.slice(0,-4);
   const missing=native.some(r=>r.date<=cutoff&&r.quantities[coin]>1e-9&&
    !(Number(cryptoRates[coin]?.[r.date])||Number(publicCryptoRates[coin]?.[r.date])||stockPrice(s,r.date)));
   if(!missing)continue;
   try {
    const archive=await require('./brokerSync/krakenArchivePrices').dailyPrices(coin+'USD');
    const merged=new Map((market.get(s)?.prices||[]).map(p=>[p.date,p.close]));
    for(const [d,p] of Object.entries(archive.prices))if(!merged.has(d))merged.set(d,p);
    const series={currency:'USD',prices:[...merged].sort(([a],[b])=>a.localeCompare(b)).map(([date,close])=>({date,close})),splits:[],from:start,to:end,proxyDates:market.get(s)?.proxyDates||[],source:'Kraken daily closes supplemented by official OHLCVT archive'};
    market.set(s,series);
    await db.query(`INSERT INTO portfolio_reconstruction_prices(symbol,payload) VALUES($1,$2) ON CONFLICT(symbol) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=NOW()`,[s,series]);
   }catch{/* A missing archive remains an explicit gap. */}
  }
  const migrationAliases=account.broker==='kraken'?migrationPriceAliases(payload?.ledger):new Map();
  // Sonic launched before Kraken retired FTM. Use its dated market price only
  // where the original FTM close is absent and this import proves a 1:1 swap.
  if(account.broker==='kraken'&&fetchPrices&&[...migrationAliases].some(([key,old])=>key.startsWith('S:')&&old==='FTM')) {
   const missing=native.filter(r=>r.date>='2024-12-18'&&r.quantities.FTM>1e-9&&!stockPrice('FTM-USD',r.date));
   if(missing.length)try {
    const candles=(await axios.get('https://data-api.binance.vision/api/v3/klines',{params:{symbol:'SUSDT',interval:'1d',startTime:Date.parse(missing[0].date),endTime:Date.parse(missing.at(-1).date)+86400000-1,limit:1000},timeout:15000,maxRedirects:0,maxContentLength:1024*1024})).data;
    const existing=market.get('FTM-USD'),prices=new Map((existing?.prices||[]).map(p=>[p.date,p.close])),proxyDates=new Set(existing?.proxyDates||[]);
    const dates=new Set(missing.map(r=>r.date));
    for(const candle of candles) {
     const d=date(Number(candle[0])),p=Number(candle[4]),usdt=Number(cryptoRates.USDT?.[d])||Number(publicCryptoRates.USDT?.[d])||stockPrice('USDT-USD',d);
     if(dates.has(d)&&p>0&&usdt>0&&!prices.has(d)){prices.set(d,p*usdt);proxyDates.add(d);}
    }
    const series={currency:'USD',prices:[...prices].sort(([a],[b])=>a.localeCompare(b)).map(([date,close])=>({date,close})),splits:[],from:start,to:end,proxyDates:[...proxyDates],source:'Kraken FTM archive; missing closes estimated from Binance Sonic/USDT and dated USDT/USD; recorded 1:1 migration'};
    market.set('FTM-USD',series);
    await db.query(`INSERT INTO portfolio_reconstruction_prices(symbol,payload) VALUES($1,$2) ON CONFLICT(symbol) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=NOW()`,['FTM-USD',series]);
   }catch{/* No fabricated prices when the replacement market is unavailable. */}
  }
  let shareIssues=new Map();
  if(account.broker==='trading212') {
   for(const s of need)for(const split of historySplits(s,market.get(s)?.splits||[]))splits.push({...split,symbol:s});
   native=replayShares(fills,splits,start,end);
   const totals=replayShares(fills,splits,start,today).at(-1)?.quantities||{};
   const current=Object.fromEntries((portfolio?.positions||[]).map(p=>[currentSymbol(p.instrument),Number(p.quantity)]));
   for(const s of new Set([...Object.keys(totals),...Object.keys(current)]))if(Math.abs((totals[s]||0)-(current[s]||0))>0.0001)shareIssues.set(s,'Corporate-action quantity coverage requires reconciliation');
  }
  const rows=[];
  const writeFrom=fromDate&&fromDate>start?fromDate:start;
  for(const d of days(writeFrom,end)) {
   let value={holdings_usd:0,cash_usd:0,stablecoins_usd:0,issues:[...blockers]};
   if(d>cutoff)value.issues.push('Beyond saved statement or sync coverage');
   if(['kraken','okx'].includes(account.broker)) {
    const quantities=native.find(r=>r.date===d)?.quantities||{};
    const price=(s,day)=>Number(cryptoRates[s]?.[day])||Number(publicCryptoRates[s]?.[day])||(s==='USDT'?Number(payload.rates?.[day])||null:stockPrice(s+'-USD',day))||
     (migrationAliases.has(`${s}:${day}`)?stockPrice(migrationAliases.get(`${s}:${day}`)+'-USD',day):null);
    if(account.broker==='kraken')for(const [s,q] of Object.entries(quantities))if(q>1e-9&&
     (!Number(cryptoRates[s]?.[d])&&!Number(publicCryptoRates[s]?.[d]))&&
     (market.get(s+'-USD')?.proxyDates?.includes(d)||(!stockPrice(s+'-USD',d)&&migrationAliases.has(`${s}:${d}`)&&price(s,d)>0)))
      value.issues.push(migrationEstimatePrefix+s);
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
      const isEtoroCfd=account.broker==='etoro'&&t.instrument_type==='cfd';
      if(!isEtoroCfd&&(!['stock','crypto'].includes(t.instrument_type)||t.side!=='long')) {value.issues.push(`Historical derivative valuation unavailable: ${t.symbol}`);continue;}
      // These broker contract names are not listed-security identifiers.
      // Missing contract prices use the explicitly approved zero estimate;
      // do not inspect splits for an unrelated similarly named Yahoo stock.
      const unsupportedContract=isEtoroCfd&&(['OIL','GOLD','SILVER','COPPER','NGAS','NATGAS','PLATINUM','PALLADIUM'].includes(t.symbol)||t.symbol.endsWith('.FUT'));
      if(unsupportedContract){value.issues.push(priceIssue(t.symbol,zeroMissingPrices));continue;}
      const s=marketSymbolFor(t),series=market.get(s);
      // Statement lot quantities may be adjusted to a later split. Without a
      // dated broker split allocation, avoid claiming a pre-split valuation.
      let quantity=Number(t.quantity);
      if(account.broker==='etoro')quantity=historicalLotQuantity(t,d,opened,closed,etoroLots.get(t)?.splits||[],series?.splits||[],etoroLots.get(t));
      else if((series?.splits||[]).some(x=>x.date>opened&&(!closed||x.date<closed)&&(closed||x.date>d)))quantity=null;
      if(quantity==null){value.issues.push(`Historic split allocation unavailable: ${t.symbol}`);continue;}
      const p=stockPrice(s,d);
      if(!(p>0))value.issues.push(priceIssue(t.symbol,zeroMissingPrices));
      else if(isEtoroCfd) {
       const currency=etoroLots.get(t)?.currency;
       const unit=currency?normaliseMinorUnit(currency):null;
       if(!unit&&series.currency!=='USD'){value.issues.push(`Historical CFD entry currency unavailable: ${t.symbol}`);continue;}
       if(unit&&unit.code!==series.currency){value.issues.push(`Historical CFD currency mismatch: ${t.symbol}`);continue;}
       const equity=cfdEquity(t,quantity,historicalPrice(series,d),fx(series.currency,d),{nativeDivisor:unit?.divisor||1});
       if(equity==null)value.issues.push(`Historical CFD collateral or entry basis unavailable: ${t.symbol}`);
       else value.holdings_usd+=equity;
      }
      else if(t.instrument_type==='crypto'&&STABLE.has(t.symbol))value.stablecoins_usd+=quantity*p;
      else value.holdings_usd+=quantity*p;
     }
    }
   }
   value.issues=[...new Set(value.issues)];
   if(blocksValue(value.issues))value.holdings_usd=value.cash_usd=value.stablecoins_usd=null;
   rows.push({...value,date:d,gbp_per_usd:fx('GBP',d)>0?1/fx('GBP',d):null});
  }
  if(apply)await db.withTransaction(async client=>{
   await client.query('DELETE FROM portfolio_reconstructed_values WHERE user_id=$1 AND account_identifier=$2 AND value_date >= $3',[userId,identifier,writeFrom]);
   for(const r of rows)await client.query(`INSERT INTO portfolio_reconstructed_values(user_id,account_identifier,value_date,holdings_usd,cash_usd,stablecoins_usd,gbp_per_usd,issues,method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[userId,identifier,r.date,r.holdings_usd,r.cash_usd,r.stablecoins_usd,r.gbp_per_usd,JSON.stringify(r.issues),method]);
  });
  const valid=rows.filter(r=>r.holdings_usd!=null);
  summaries.push({broker:account.broker,days:valid.length,estimatedDays:valid.filter(r=>r.issues.length).length,first:valid[0]?.date,last:valid.at(-1)?.date,gaps:rows.length-valid.length,issues:[...new Set(rows.flatMap(r=>r.issues))]});
  onProgress({broker:account.broker,stage:'complete',days:valid.length,gaps:rows.length-valid.length});
 }
 return summaries;
}
module.exports={reconstruct,walletHistory,historicalPrice,valueQuantities,parseYahoo,replayShares,migrationPriceAliases};
