// eToro documents SHIBxM as one million SHIB units. Only crypto providers
// translate the underlying quote; broker-native lot quotes remain unchanged.
// https://www.etoro.com/markets/shibxm
function underlying(symbol){return String(symbol).toUpperCase()==='SHIBXM'?{symbol:'SHIB',units:1000000}:{symbol:String(symbol).toUpperCase(),units:1};}
function scale(candles,units){return candles.map(c=>({...c,...Object.fromEntries(['open','high','low','close'].filter(k=>c[k]!=null).map(k=>[k,c[k]*units])),...(c.volume!=null?{volume:c.volume/units}:{})}));}
module.exports={underlying,scale};
