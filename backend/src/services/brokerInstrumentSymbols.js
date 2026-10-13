const db=require('../config/database');
const {normalizeTicker,currentSymbol,catalogueSymbols}=require('./brokerSync/trading212Instruments');
const {historySymbol}=require('./portfolioCorporateActions');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');
function catalogueMapping(items=[]){
 const map=new Map();
 for(const i of items){
  const original=normalizeTicker(i.ticker),current=currentSymbol(i);
  if(original!==current&&!catalogueSymbols(items,original).includes(current))continue;
  map.set(i.ticker,current);map.set(original,current);
 }
 return map;
}
async function saveCatalogue(connection,items){
 if(!connection.userId||!connection.externalAccountId)return;
 const instruments=items.filter(i=>i&&typeof i==='object').map(i=>Object.fromEntries(['ticker','shortName','isin','name','currencyCode','type'].filter(k=>typeof i[k]==='string').map(k=>[k,i[k]]))).filter(i=>i.ticker);
 const rawByTicker=new Map(items.filter(i=>i?.ticker).map(i=>[i.ticker,i]));
 for(const item of instruments){const raw=rawByTicker.get(item.ticker);if(raw?.maxOpenQuantity!=null&&Number.isFinite(Number(raw.maxOpenQuantity))&&Number(raw.maxOpenQuantity)>=0)item.maxOpenQuantity=Number(raw.maxOpenQuantity);}
 await db.query("INSERT INTO broker_instrument_catalogues(user_id,broker_type,account_identifier,instruments) VALUES($1,'trading212',$2,$3::jsonb) ON CONFLICT(user_id,broker_type,account_identifier) DO UPDATE SET instruments=EXCLUDED.instruments,fetched_at=NOW()",[connection.userId,'****'+String(connection.externalAccountId).slice(-4),JSON.stringify(instruments)]);
}
async function catalogueForAccount(client,userId,accountIdentifier){
 const row=(await client.query("SELECT instruments FROM broker_instrument_catalogues WHERE user_id=$1 AND broker_type='trading212' AND account_identifier=$2",[userId,accountIdentifier])).rows[0];
 return Array.isArray(row?.instruments)?row.instruments:null;
}
async function cataloguesForUser(client,userId){
 return (await client.query("SELECT account_identifier,instruments FROM broker_instrument_catalogues WHERE user_id=$1 AND broker_type='trading212'",[userId])).rows.filter(r=>Array.isArray(r.instruments));
}
function historicalSymbol(mapping,raw,date){
 const original=normalizeTicker(raw);
 // Retain the existing dated SPAC/corporate-action boundary.
 if(original==='SRNG'&&date<'2021-09-17')return original;
 return historySymbol(mapping.get(raw)||mapping.get(original)||original,date);
}
async function applyTradeMarketSymbols(client,userId,trades){
 const stocks=trades.filter(t=>t.broker==='trading212'&&(t.instrument_type||'stock')==='stock');
 if(!stocks.length)return;
 const catalogues=await cataloguesForUser(client,userId),maps=new Map(catalogues.map(r=>[r.account_identifier,catalogueMapping(r.instruments)]));
 for(const t of stocks){
  const mapping=maps.get(t.account_identifier)||new Map(),raw=t.underlying_symbol||t.symbol;
  const symbol=historicalSymbol(mapping,raw,new Date().toISOString().slice(0,10));
  t.market_symbol=symbol;
  const items=catalogues.find(r=>r.account_identifier===t.account_identifier)?.instruments||[];
  const instrument=items.find(i=>normalizeTicker(i.ticker)===raw&&historicalSymbol(mapping,normalizeTicker(i.ticker),new Date().toISOString().slice(0,10))===symbol);
  const unit=normaliseMinorUnit(instrument?.currencyCode);
  if(unit){t.market_currency=instrument.currencyCode;t.instrument_currency=unit.code;}
  if(symbol!==(t.plan_trade?.sourceSymbol||raw)){t.current_price=null;t.currentPrice=null;}
 }
}
async function applyTradeHistoricalSymbols(client,userId,trades) {
 const stocks=trades.filter(t=>t.broker==='trading212'&&(t.instrument_type||'stock')==='stock');
 if(stocks.length){
  const catalogues=await cataloguesForUser(client,userId);
  const maps=new Map(catalogues.map(r=>[r.account_identifier,catalogueMapping(r.instruments)]));
  for(const t of stocks)t.history_market_symbol=historicalSymbol(maps.get(t.account_identifier)||new Map(),t.underlying_symbol||t.symbol,new Date(t.entry_time||t.trade_date).toISOString().slice(0,10));
 }
 // Reuse position/date/cost-verified statement identity, scoped to the account.
 // A short ticker or account settlement currency alone cannot identify a listing.
 const etoro=trades.filter(t=>t.broker==='etoro'&&['stock','cfd'].includes(t.instrument_type||'stock'));
 if(!etoro.length)return;
 const reports=(await client.query(`SELECT a.account_identifier,r.records FROM broker_cash_reports r
  JOIN user_accounts a ON a.id=r.account_id
  WHERE r.user_id=$1 AND r.broker_type='etoro' AND a.user_id=$1`,[userId])).rows;
 const {statementLotMetadata,statementSplits}=require('./etoroHistoricalSplits');
 for(const account of new Set(etoro.map(t=>t.account_identifier))){
  const originals=etoro.filter(t=>t.account_identifier===account&&Number.isFinite(Date.parse(t.entry_time||t.trade_date)));
  const rows=originals.map(t=>({...t,entry_time:t.entry_time||t.trade_date,executions:Array.isArray(t.executions)?t.executions:[]}));
  const records=reports.filter(r=>r.account_identifier===account).flatMap(r=>r.records||[]);
  const metadata=statementLotMetadata(rows,records,statementSplits(records));
  for(let i=0;i<rows.length;i++){const t=originals[i],evidence=metadata.get(rows[i]);
   if(evidence?.statementAuthority&&evidence.marketSymbol&&evidence.currency){
    t.history_market_symbol=historicalSymbol(new Map(),evidence.marketSymbol,new Date(t.entry_time||t.trade_date).toISOString().slice(0,10));
    t.history_market_currency=evidence.currency;
   }
  }
 }
}
// The same verified aliases are used for list rows, counts and analytics.
async function tradeSymbolAliases(client,userId,search,exact=false){
 const target=String(search||'').trim().toUpperCase(),aliases=[];
 for(const row of await cataloguesForUser(client,userId)){
  for(const item of row.instruments){
   const current=currentSymbol(item),original=normalizeTicker(item.ticker);
   if(original!==current&&(exact?current===target:current.startsWith(target))&&catalogueSymbols(row.instruments,original).includes(current)){
    for(const symbol of new Set([item.ticker,original]))aliases.push({account_identifier:row.account_identifier,symbol});
   }
  }
 }
 return aliases;
}
function tradeSymbolAliasSql(parameter,alias='t'){
 return `(${alias}.broker='trading212' AND COALESCE(${alias}.instrument_type,'stock')='stock'
 AND EXISTS (SELECT 1 FROM jsonb_to_recordset($${parameter}::jsonb)
 AS instrument_aliases(account_identifier text,symbol text)
 WHERE instrument_aliases.account_identifier=${alias}.account_identifier
 AND instrument_aliases.symbol=UPPER(${alias}.symbol)))`;
}
module.exports={applyTradeHistoricalSymbols,tradeSymbolAliases,tradeSymbolAliasSql,catalogueMapping,saveCatalogue,catalogueForAccount,cataloguesForUser,historicalSymbol,applyTradeMarketSymbols};
