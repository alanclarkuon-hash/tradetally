const db = require('../config/database');
const cache = require('../utils/cache');
const {CRYPTO_TO_COINGECKO} = require('../utils/cryptoAssets');

// Explicit sources keep unrelated application data and broker credentials out.
const SOURCES = [
  ['symbol_categories','Asset profile',false,'updated_at'],
  ['asset_reference_classifications','FinanceDatabase classification',false,'fetched_at'],
  ['price_monitoring','Saved market quote',false,'last_updated'],
  ['eight_pillars_analysis','Fundamental analysis',false,'analysis_date'],
  ['stock_financials_cache','Financial statements',false,'fetched_at'],
  ['global_enrichment_cache','Market enrichment',false,'updated_at'],
  ['enrichment_cache','Trade enrichment',false,'updated_at'],
  ['historical_prices','Historical prices',false,'price_date'],
  ['intraday_candles','Intraday prices',false,'ts'],
  ['intraday_candle_coverage','Intraday price coverage',false,'fetched_at'],
  ['tick_data','Saved price ticks',false,'timestamp'],
  ['tick_data_cache','Price tick coverage',false,'fetched_at'],
  ['stock_splits','Stock splits',false,'split_date'],
  ['stock_split_check_log','Split check history',false,'created_at'],
  ['stock_pillar_results','Stock scan results',false,'updated_at'],
  ['news_cache','Saved news',false,'news_date'],
  ['dashboard_news_cache','Dashboard news',false,'fetched_at'],
  ['broker_portfolio_snapshots','Your broker holdings',true,'synced_at'],
  ['investment_lots','Your investment lots',true,'purchase_date'],
  ['investment_holdings','Your saved holdings',true,'updated_at'],
  ['trades','Your trades',true,'entry_time'],
  ['investment_dividends','Your investment dividends',true,'payment_date'],
  ['trade_dividends','Your trade dividends',true,'payment_date'],
  ['stock_valuations','Your saved valuations',true,'valuation_date'],
  ['portfolio_targets','Your allocation targets',true,'updated_at'],
  ['price_alerts','Your price alerts',true,'created_at'],
  ['instrument_templates','Your instrument templates',true,'updated_at'],
  ['round_trip_trades','Your grouped trades',true,'updated_at'],
  ['broker_trade_exclusions','Your excluded broker trades',true,'created_at'],
  ['backtest_sessions','Your backtests',true,'updated_at'],
  ['watchlist_items','Your watchlist entries',true,'added_at']
];
function validateSymbol(value) {
  const symbol=String(value||'').trim().toUpperCase();
  if(!/^[A-Z0-9.^=_/-]{1,30}$/.test(symbol)){const e=Error('Enter a valid asset symbol, including its exchange suffix if needed.');e.status=400;throw e;}
  return symbol;
}
async function readSource(userId,symbol,source,offset=0) {
  const [table,title,owned,date]=source;
  if(table==='broker_portfolio_snapshots') {
    const rows=(await db.query('SELECT broker_type,account_identifier,positions,synced_at FROM broker_portfolio_snapshots WHERE user_id=$1',[userId])).rows;
    const normalizeTicker=require('./brokerSync/trading212Service').normalizeTicker;
    const records=rows.flatMap(row=>(Array.isArray(row.positions)?row.positions:[]).filter(p=>
      (row.broker_type==='trading212'?normalizeTicker(p.instrument?.ticker):String(p.symbol||'').toUpperCase())===symbol
    ).map(position=>({broker:row.broker_type,account_identifier:row.account_identifier,synced_at:row.synced_at,position})));
    return {key:table,title,count:records.length,offset,records:records.slice(offset,offset+25)};
  }
  if(table==='investment_lots') {
    const where='FROM investment_lots l JOIN investment_holdings h ON h.id=l.holding_id WHERE h.symbol=$1 AND h.user_id=$2 AND l.user_id=$2';
    const [count,rows]=await Promise.all([
      db.query(`SELECT count(*)::int AS count ${where}`,[symbol,userId]),
      db.query(`SELECT l.* ${where} ORDER BY l.purchase_date DESC LIMIT 25 OFFSET $3`,[symbol,userId,offset])
    ]);
    return {key:table,title,count:count.rows[0].count,offset,records:rows.rows.map(({user_id,...row})=>row)};
  }
  if(table==='watchlist_items') {
    const where='FROM watchlist_items i JOIN watchlists w ON w.id=i.watchlist_id WHERE i.symbol=$1 AND w.user_id=$2';
    const [count,rows]=await Promise.all([
      db.query(`SELECT count(*)::int AS count ${where}`,[symbol,userId]),
      db.query(`SELECT i.* ${where} ORDER BY i.added_at DESC LIMIT 25 OFFSET $3`,[symbol,userId,offset])
    ]);
    return {key:table,title,count:count.rows[0].count,offset,records:rows.rows};
  }
  const where=`symbol=$1${owned?' AND user_id=$2':''}`;
  const params=owned?[symbol,userId]:[symbol];
  const [count,records]=await Promise.all([
    db.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`,params),
    db.query(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${date} DESC NULLS LAST LIMIT 25 OFFSET $${params.length+1}`,[...params,offset])
  ]);
  // Internal ownership/link identifiers are not asset attributes.
  return {key:table,title,count:count.rows[0].count,offset,records:records.rows.map(({user_id,broker_connection_id,...row})=>row)};
}
async function getDetails(userId,input,query={}) {
  const symbol=validateSymbol(input);
  if(query.source) {
    const source=SOURCES.find(s=>s[0]===query.source);
    const offset=Number(query.offset||0);
    if(!source||!Number.isSafeInteger(offset)||offset<0){const e=Error('Invalid saved record page');e.status=400;throw e;}
    return readSource(userId,symbol,source,offset);
  }
  const sections=await Promise.all(SOURCES.map(s=>readSource(userId,symbol,s)));
  const profile=sections.find(s=>s.key==='symbol_categories').records[0];
  const providerReference=sections.find(s=>s.key==='asset_reference_classifications').records[0];
  const reference=require('./classificationOverrides').applyOverrides([symbol],new Map(providerReference?[[symbol,providerReference]]:[])).get(symbol);
  const trades=sections.find(s=>s.key==='trades').records;
  const isCrypto=trades.some(t=>t.instrument_type==='crypto')||(!profile&&Boolean(CRYPTO_TO_COINGECKO[symbol]));
  const crypto=await require('./cryptoCategoriesService').getCachedCategories(symbol);
  const fund=cache.get('yahoo_fund_labels',symbol);
  const yahoo=cache.get('yahoo_symbol_profile',symbol);
  const fundMetadata=require('./categoryOverrides').applyCategoryOverride(symbol,'fund',fund);
  const isFund=Boolean(fund)||['ETF','MUTUALFUND'].includes(yahoo?.quoteType)||fundMetadata?.source==='Manual override';
  const metadata=isCrypto?require('./categoryOverrides').applyCategoryOverride(symbol,'crypto',crypto):isFund?fundMetadata:null;
  const storedLabels=isCrypto?[]:[...new Set(sections.filter(s=>['symbol_categories','global_enrichment_cache','enrichment_cache','eight_pillars_analysis'].includes(s.key)).flatMap(s=>s.records.flatMap(r=>
    ['finnhub_industry','gics_sector','gics_group','gics_industry','gics_sub_industry','sector','industry','country'].filter(k=>r[k]).map(k=>`${k.replace('finnhub_','').replaceAll('_',' ')}: ${r[k]}`))))];
  return {symbol,name:isCrypto?symbol:profile?.company_name||yahoo?.name||symbol,
    kind:isCrypto?'Crypto':isFund?'Fund / ETF':'Stock or other asset',
    labels:[...new Set([...(metadata?.categories||[]),...storedLabels])],labelSource:[metadata?.source,storedLabels.length?'Saved database classifications':null].filter(Boolean).join(' · ')||null,labelAsOf:metadata?.asOf||profile?.updated_at||null,
    referenceClassification:isCrypto||isFund?null:reference||null,
    categoryOverride:metadata?.source==='Manual override'?metadata:null,
    categoryWarning:metadata?.override_warning||null,
    cachedProfile:yahoo||null,sections,recordCount:sections.reduce((n,s)=>n+s.count,0),
    warning:isCrypto&&profile?'Some older symbol-only database records may describe a stock with the same ticker. Check their source before using them as crypto classifications.':null};
}
module.exports={getDetails,validateSymbol,SOURCES};
