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
module.exports={catalogueMapping,saveCatalogue,catalogueForAccount,cataloguesForUser,historicalSymbol,applyTradeMarketSymbols};
