const db = require('../config/database');
const Portfolio = require('./portfolioService');
const Account = require('../models/Account');
const {getRatesToDisplay} = require('../utils/displayCurrency');
const {parseReportDateRange} = require('../utils/reportDateRange');
const STABLE = new Set(['USDT','USDC','USDG','DAI','FDUSD','TUSD','USDP','PYUSD','EURC','EURT']);
const FIAT = new Set(['USD','GBP','EUR','CAD','AUD','JPY','CHF']);

function periodResult(position, range, rates, lots) {
  if (!range) return {pnl:position.unrealizedPnL, percent:position.unrealizedPnLPercent,basis:position.totalCostBasis};
  if (!['stock','crypto'].includes(position.instrumentType)) return {pnl:null,percent:null};
  // Period P&L is for the lots still held today, not a claim about closed trades.
  // Historical prices must be explicitly denominated in USD; opaque market
  // candles cannot safely be mixed with broker wallet values (e.g. UK pence).
  if (!lots?.length || Math.abs(lots.reduce((s,l)=>s+Number(l.quantity),0)-position.totalShares)>Math.max(1e-8,position.totalShares*1e-7))
    return {pnl:null,percent:null};
  const date = new Date().toISOString().slice(0,10);
  const quote = key => {
    const exact = rates?.[key];
    if (exact>0) return exact;
    for(let days=1;days<=4;days++) {
      const d=new Date(key+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days);
      if(rates?.[d.toISOString().slice(0,10)]>0)return rates[d.toISOString().slice(0,10)];
    }
    return null;
  };
  const endPrice = range.end_date===date ? position.currentPrice : quote(range.end_date);
  if (!(endPrice>0)) return {pnl:null,percent:null};
  let basis=0,value=0;
  for (const lot of lots) {
    const acquired=new Date(lot.acquired).toISOString().slice(0,10);
    if(acquired>range.end_date)continue;
    const startPrice=acquired>=range.start_date ? Number(lot.price) : quote(range.start_date);
    if(!(startPrice>0))return {pnl:null,percent:null};
    basis+=Number(lot.quantity)*startPrice;
    value+=Number(lot.quantity)*endPrice;
  }
  return basis>0 ? {pnl:value-basis,percent:(value-basis)/basis*100,basis} : {pnl:null,percent:null};
}

async function getDashboard(userId, query={}) {
  const range=parseReportDateRange(query);
  const currency=query.currency || 'GBP';
  if(!['GBP','USD'].includes(currency)){const e=Error('Choose GBP or USD');e.status=400;throw e;}
  const selected=String(query.accounts || '').split(',').map(x=>x.trim()).filter(Boolean);
  const positions=await Portfolio.getPositions(userId,{accounts:selected.join(',')});
  const symbols=positions.map(p=>p.symbol);
  const [accounts,industries,snapshots,tradeLots,manualLots]=await Promise.all([
    db.query('SELECT id,account_name,account_identifier,broker,currency FROM user_accounts WHERE user_id=$1 AND is_archived=false',[userId]),
    db.query(`SELECT DISTINCT ON(symbol) symbol,industry,sector FROM (
      SELECT symbol,industry,sector,updated_at FROM enrichment_cache
      UNION ALL SELECT symbol,industry,sector,updated_at FROM global_enrichment_cache
      UNION ALL SELECT symbol,industry,NULL AS sector,analysis_date AS updated_at FROM eight_pillars_analysis
    ) classifications WHERE symbol=ANY($1) AND (industry IS NOT NULL OR sector IS NOT NULL)
      ORDER BY symbol,updated_at DESC`,[symbols]),
    db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='kraken'",[userId]),
    range ? db.query(`SELECT symbol,quantity,entry_price AS price,entry_time AS acquired FROM trades
      WHERE user_id=$1 AND exit_time IS NULL AND side='long' AND symbol=ANY($2)
      AND ($3::text[]='{}' OR account_identifier=ANY($3))`,[userId,symbols,selected]) : {rows:[]},
    range ? db.query(`SELECT h.symbol,l.shares AS quantity,l.cost_per_share AS price,l.purchase_date AS acquired
      FROM investment_lots l JOIN investment_holdings h ON h.id=l.holding_id
      WHERE l.user_id=$1 AND h.symbol=ANY($2) AND ($3::text[]='{}' OR l.account_identifier=ANY($3))`,[userId,symbols,selected]) : {rows:[]}
  ]);
  const managed=accounts.rows.filter(a=>!selected.length||selected.includes(a.account_identifier));
  const fx=await getRatesToDisplay(['USD',...managed.map(a=>a.currency)],currency);
  if(!(fx.USD>0))throw Error('Display currency conversion is unavailable');
  const cashRows=await Promise.all(managed.map(async a=>{
    if(a.broker==='okx')return {name:a.account_name,amount:0,source:'Coins and stablecoins only'};
    const flow=await Account.getCashflow(userId,a.id);
    const live=flow?.summary?.liveCashBalance;
    const amount=live?.amount ?? flow?.summary?.currentBalance;
    const sourceCurrency=live?.currency || a.currency;
    if(!flow || flow.summary.cashflowSource==='trade_history' || !Number.isFinite(amount) || !(fx[sourceCurrency]>0))
      return {name:a.account_name,amount:null,source:'Cash history unavailable'};
    return {name:a.account_name,amount:amount*fx[sourceCurrency],source:flow.summary.cashflowSource};
  }));
  const industriesBySymbol=new Map(industries.rows.map(r=>[r.symbol,r.industry||r.sector]));
  // Use the existing exact-symbol profile cache/provider. Fund holdings are
  // grouped as funds rather than pretending their entire value is one industry.
  const candidates=positions.filter(p=>p.instrumentType!=='crypto' && !industriesBySymbol.has(p.symbol));
  const yahoo=require('../utils/yahooFinance');
  for(let i=0;i<candidates.length;i+=4) {
    await Promise.all(candidates.slice(i,i+4).map(async p=>{
      const profile=await yahoo.getSymbolProfile(p.symbol);
      if(profile?.industry)industriesBySymbol.set(p.symbol,profile.industry);
      else if(['ETF','MUTUALFUND'].includes(profile?.quoteType))industriesBySymbol.set(p.symbol,'Funds & ETFs');
    }));
  }
  const cryptoRates={};
  for(const row of snapshots.rows)Object.assign(cryptoRates,row.payload.valuation?.rates || {});
  const lotMap=new Map();
  for(const lot of [...tradeLots.rows,...manualLots.rows]){const list=lotMap.get(lot.symbol)||[];list.push(lot);lotMap.set(lot.symbol,list);}
  if(range) {
    const equities=positions.filter(p=>p.instrumentType==='stock' && lotMap.has(p.symbol));
    const converter=require('../utils/currencyConverter');
    const from=new Date(range.start_date+'T00:00:00Z');from.setUTCDate(from.getUTCDate()-5);
    for(let i=0;i<equities.length;i+=4) {
      await Promise.all(equities.slice(i,i+4).map(async p=>{
        try {
          const chart=await yahoo.getStockTradeChartData(p.symbol,from.toISOString(),range.end_date+'T23:59:59Z','D');
          const prices={};
          // Only the boundary prices are needed. The provider declares the
          // currency and normalizes GBp/GBX before we convert to dated USD.
          for(const boundary of [range.start_date,range.end_date]) {
            const candidates=chart.candles.filter(c=>new Date(c.time*1000).toISOString().slice(0,10)<=boundary);
            const candle=candidates.at(-1);if(!candle)continue;
            const day=new Date(candle.time*1000).toISOString().slice(0,10);
            const rate=await converter.getForexRate(chart.candles_currency,'USD',day);
            if(rate>0)prices[day]=candle.close*rate;
          }
          cryptoRates[p.symbol]=prices;
        } catch (_) { /* Missing price history stays explicitly unavailable. */ }
      }));
    }
  }
  const holdings=[],stablecoins=[];
  const categoryService=require('./cryptoCategoriesService');
  const categoriesBySymbol=new Map(await Promise.all(positions.filter(p=>p.instrumentType==='crypto' && !STABLE.has(p.symbol) && !FIAT.has(p.symbol)).map(async p=>[p.symbol,await categoryService.getCategories(p.symbol)])));
  let missingPrices=0;
  for(const p of positions) {
    if(p.instrumentType==='crypto' && FIAT.has(p.symbol))continue;
    const result=periodResult(p,range,cryptoRates[p.symbol],lotMap.get(p.symbol));
    const metadata=categoriesBySymbol.get(p.symbol);
    const row={symbol:p.symbol,industry:p.instrumentType==='crypto'?(metadata?.primaryCategory?`Crypto · ${metadata.primaryCategory}`:'Crypto · Unclassified'):industriesBySymbol.get(p.symbol)||p.sector||'Unclassified',
      assetClass:p.instrumentType==='crypto'?'Crypto assets':null,category:metadata?.primaryCategory||'Unclassified',
      categories:metadata?.categories||[],categorySource:metadata?.source||null,categoryAsOf:metadata?.asOf||null,categoryStale:metadata?.stale||false,
      value:p.currentValue==null?null:p.currentValue*fx.USD,cost:p.totalCostBasis*fx.USD,
      pnl:result.pnl==null?null:result.pnl*fx.USD,pnlPercent:result.percent,pnlBasis:result.basis==null?null:result.basis*fx.USD,
      quantity:p.totalShares,priceAsOf:p.priceAsOf,priceStale:p.priceStale,accounts:p.accountIdentifiers};
    if(row.value==null)missingPrices++;
    (p.instrumentType==='crypto' && STABLE.has(p.symbol)?stablecoins:holdings).push(row);
  }
  const holdingsValue=holdings.reduce((s,p)=>s+(p.value??0),0),stablecoinValue=stablecoins.reduce((s,p)=>s+(p.value??0),0);
  const cashValue=cashRows.reduce((s,a)=>s+(a.amount??0),0);
  const completePnl=holdings.every(p=>p.pnl!=null);
  const basis=holdings.reduce((s,p)=>s+(p.pnlBasis??0),0);
  return {currency,asOf:new Date().toISOString(),range,holdings,stablecoins,cashAccounts:cashRows,
    totals:{portfolioValue:holdingsValue+stablecoinValue+cashValue,holdingsValue,cashValue,stablecoinValue,
      pnl:completePnl?holdings.reduce((s,p)=>s+p.pnl,0):null,pnlPercent:completePnl&&basis>0?holdings.reduce((s,p)=>s+p.pnl,0)/basis*100:null},
    coverage:{missingCash:cashRows.filter(a=>a.amount==null).length,missingPrices,
      missingPnl:holdings.filter(p=>p.pnl==null).length,unclassified:holdings.filter(p=>p.industry==='Unclassified').length},
    accountCount:managed.length};
}
module.exports={getDashboard,periodResult,STABLE};
