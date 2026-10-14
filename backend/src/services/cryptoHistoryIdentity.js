// A ticker is not a coin identity. Keep known collisions in a separate history
// namespace; legacy prices remain available for audit, never for this token.
const sky={symbol:'SKY',coinGeckoId:'sky',firstDate:'2024-09-18',
 source:'https://www.etoro.com/markets/sky'};
function coin(symbol){return String(symbol).replace(/^crypto:/i,'').replace(/-USD$/i,'').toUpperCase()==='SKY'?sky:null;}
function historyKey(symbol){return String(symbol).toUpperCase()==='CRYPTO:SKY'?'crypto:SKY:sky':symbol;}
function nativeKey(symbol){return String(symbol).toUpperCase()==='SKY-USD'?'SKY@sky-USD':symbol;}
function evidence(symbol){const c=coin(symbol);return c?{coinGeckoId:c.coinGeckoId,quoteCurrency:'USD',units:'native-token'}:null;}
function usableNative(symbol,payload){const c=coin(symbol);return !c||payload?.cryptoIdentity?.coinGeckoId===c.coinGeckoId&&payload.cryptoIdentity.quoteCurrency==='USD'&&payload.cryptoIdentity.units==='native-token';}
function sourceAllowed(symbol,source){return !coin(symbol)||['broker:kraken','broker:okx','broker:kraken:crypto','broker:okx:crypto','coingecko','kraken','okx','reconstruction_cache:sky'].includes(source);}
function dated(symbol,rows){const c=coin(symbol);return c?rows.filter(p=>new Date(p.time*1000).toISOString().slice(0,10)>=c.firstDate):rows;}
function lotIdentity(t){
 if(t.instrument_type!=='crypto'||String(t.symbol).toUpperCase()!=='SKY'||t.broker!=='etoro')return null;
 const opened=t.entry_time||t.trade_date?new Date(t.entry_time||t.trade_date).toISOString().slice(0,10):'',closed=t.exit_time?new Date(t.exit_time).toISOString().slice(0,10):null;
 // eToro relabels closed Maker lots as SKY. A lot closed before SKY existed
 // never underwent the later unit conversion; retain its original MKR units.
 if(opened&&opened<sky.firstDate){
  const native=(t.executions||[]).some(e=>e.type==='entry'&&e.etoro_source_type==='Crypto'&&['SKY','MKR'].includes(e.etoro_statement_symbol)&&Number(e.etoro_native_price)>0);
  if(native&&closed&&closed<sky.firstDate)return {symbol:'MKR'};
  return {unsupported:true,reason:'Historical Maker/SKY conversion date and lot units are not verified'};
 }
 return null;
}
module.exports={coin,historyKey,nativeKey,evidence,usableNative,sourceAllowed,dated,lotIdentity};
