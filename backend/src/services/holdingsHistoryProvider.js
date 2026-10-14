const axios = require('axios');
const coinGecko = require('./coinGeckoClient');
const identity = require('./coinGeckoIdentityService');
const DAY = 86400000;
const iso = value => new Date(value).toISOString().slice(0, 10);
const sessionFormatters=new Map();
function yahooSessionDate(time,meta={}) {
 const zone=meta.exchangeTimezoneName;
 if(!zone)return iso(time*1000);
 if(!sessionFormatters.has(zone)){
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
  if(sessionFormatters.size>=128)sessionFormatters.delete(sessionFormatters.keys().next().value);
  sessionFormatters.set(zone,formatter);
 }
 const parts=sessionFormatters.get(zone).formatToParts(new Date(time*1000));
 return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}

// Only absent dates are requested. Weekends are not missing stock sessions.
function missingRanges(candles, from, to, crypto = false, calendar = null) {
  const known = new Set(candles.map(c => iso(c.time * 1000)));
  const ranges = []; let range;
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) {
    const d = iso(t);
    if (!crypto && !require('./exchangeCalendar').isTradingDay(d, calendar)) continue;
    if (known.has(d)) { range = null; continue; }
    if (!range) { range = { from: d, to: d }; ranges.push(range); }
    else range.to = d;
  }
  return ranges;
}

// Broker namespaces differ from provider listing suffixes. Formatting changes
// the provider request only; financial records and cache keys remain untouched.
const namespaceRules={
 US:{suffix:'',currency:'USD',venues:/^(NYQ|NMS|NGM|NCM|PCX|ASE|BTS|NYSE|NASDAQ|NYSEARCA|TEX|TXSE)$/i},
 NV:{suffix:'.AS',currency:'EUR',venues:/^(AMS|XAMS|AMSTERDAM)$/i},
 ZU:{suffix:'.SW',currency:'CHF',venues:/^(EBS|SWX|SIX|XSWX)$/i},
 ASX:{suffix:'.AX',currency:'AUD',venues:/^(ASX|XASX)$/i}
};
const verifiedAliases=new Map(require('./calendars/verified-yahoo-aliases.json').listings.map(l=>[l.symbol,l]));
function yahooListing(symbol) {
 const alias=verifiedAliases.get(String(symbol).toUpperCase());
 if(alias)return {...alias,venues:new RegExp('^'+alias.venue+'$','i')};
 const hk=/^0[0-9]{4}\.HK$/i.test(symbol);
 if(hk)return {ticker:symbol.slice(1).toUpperCase(),currency:'HKD',venues:/^(HKG|HKEX|XHKG|HONG KONG)$/i};
 const match=/^([A-Z][A-Z0-9.-]*)\.(US|NV|ZU|ASX)$/i.exec(symbol);
 if(!match)return null;
 const rule=namespaceRules[match[2].toUpperCase()];
 const base=match[1].toUpperCase();
 return {...rule,ticker:(match[2].toUpperCase()==='US'?base.replace(/^([A-Z0-9]+)\.([AB])$/,'$1-$2'):base)+rule.suffix};
}
function yahooTicker(symbol) {
 return yahooListing(symbol)?.ticker || (symbol === 'BRK.B' ? 'BRK-B' : symbol);
}
function verifyYahooListing(symbol,meta) {
 if(String(meta?.symbol||'').toUpperCase()!==yahooTicker(symbol).toUpperCase())
   throw new Error('Historical listing identity does not match requested symbol');
 const listing=yahooListing(symbol);
 if(listing && (meta.currency!==listing.currency || !listing.venues.test(meta.exchangeName||'')))
   throw new Error('Historical listing venue or currency does not match requested symbol');
 if(/\.(AX|ASX)$/i.test(symbol)&&!meta.exchangeTimezoneName)
   throw new Error('Historical Australian listing session timezone is missing');
}
async function yahoo(symbol, from, to) {
  const ticker = yahooTicker(symbol);
  const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`, {
    params: { interval: '1d', period1: Date.parse(from) / 1000 - 86400, period2: Date.parse(to) / 1000 + 2 * 86400 },
    timeout: 12000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024,
    headers: { 'User-Agent': 'TradeTally historical prices' }
  });
  const result = response.data?.chart?.result?.[0], quote = result?.indicators?.quote?.[0];
  verifyYahooListing(symbol,result?.meta);
  const first=Number(result.meta.firstTradeDate)||0;
  const firstDay=first?yahooSessionDate(first,result.meta):null;
  return (result?.timestamp || []).flatMap((time,i)=>{
   if(!(quote?.close?.[i]>0)||!Number.isFinite(time))return [];
   const day=yahooSessionDate(time,result.meta);
   if(day<from||day>to||firstDay&&day<firstDay)return [];
   return [{time:Date.parse(day)/1000,close:quote.close[i],open:quote.open?.[i]??quote.close[i],high:quote.high?.[i]??quote.close[i],low:quote.low?.[i]??quote.close[i],volume:quote.volume?.[i]||0,currency:result.meta?.currency||null}];
  });
}

async function crypto(symbol, from, to) {
  const quote=require('./cryptoPriceUnits').underlying(symbol);
  const coin = await identity.resolve(quote.symbol);
  if (!coin) throw new Error('Crypto identity unavailable');
  // The Demo plan cannot fetch older history. Retain cached older dates.
  const earliest = iso(Date.now() - 364 * DAY);
  from = from < earliest ? earliest : from;
  if (from > to) return [];
  const response = await coinGecko.get(`/coins/${coin.id}/market_chart/range`, {
    params: { vs_currency: 'usd', from: Date.parse(from) / 1000, to: Date.parse(to) / 1000 + 86400 }, ttl: DAY
  });
  const daily = new Map();
  for (const [time, close] of response.data?.prices || []) {
    const date = iso(time);
    if (close > 0 && date >= from && date <= to && !daily.has(date))
      daily.set(date, { time: Date.parse(date) / 1000, close, open: close, high: close, low: close, volume: 0 });
  }
  return require('./cryptoPriceUnits').scale([...daily.values()],quote.units);
}
module.exports = { missingRanges, yahoo, crypto, yahooTicker, verifyYahooListing, yahooSessionDate };

// Registered provider IDs and issuer names must both agree; SKY-USD is Skycoin.
async function yahooCrypto(symbol,from,to) {
 const identity=require('./cryptoHistoryIdentity'),listing=identity.yahooListing(symbol);
 if(!listing)throw Error('Verified crypto listing unavailable');
 const response=await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/'+listing.ticker,{params:{interval:'1d',period1:Date.parse(from)/1000,period2:Date.parse(to)/1000+86400},timeout:12000,maxRedirects:0,maxContentLength:8*1024*1024,headers:{'User-Agent':'TradeTally verified crypto history'}});
 const r=response.data?.chart?.result?.[0],meta=r?.meta;
 if(meta?.symbol!==listing.ticker||meta.currency!=='USD'||meta.exchangeName!=='CCC'||(meta.longName||meta.shortName)!==listing.name)throw Error('Crypto listing identity mismatch');
 const quote=r.indicators?.quote?.[0];
 return identity.dated(symbol,(r.timestamp||[]).flatMap((time,i)=>{
  if(!Number.isFinite(time)||time%86400||!(quote?.close?.[i]>0))return [];
  const d=iso(time*1000);if(d<from||d>to)return [];
  return [{time,close:quote.close[i],open:quote.open?.[i]??quote.close[i],high:quote.high?.[i]??quote.close[i],low:quote.low?.[i]??quote.close[i],volume:quote.volume?.[i]||0,currency:'USD'}];
 }));
}
module.exports.yahooCrypto=yahooCrypto;
