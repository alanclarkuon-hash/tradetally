const axios = require('axios');
const coinGecko = require('./coinGeckoClient');
const identity = require('./coinGeckoIdentityService');
const DAY = 86400000;
const iso = value => new Date(value).toISOString().slice(0, 10);

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
 US:{suffix:'',currency:'USD',venues:/^(NYQ|NMS|NGM|NCM|PCX|ASE|BTS|NYSE|NASDAQ|NYSEARCA)$/i},
 NV:{suffix:'.AS',currency:'EUR',venues:/^(AMS|XAMS|AMSTERDAM)$/i},
 ZU:{suffix:'.SW',currency:'CHF',venues:/^(EBS|SWX|SIX|XSWX)$/i},
 ASX:{suffix:'.AX',currency:'AUD',venues:/^(ASX|XASX)$/i}
};
function yahooListing(symbol) {
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
}
async function yahoo(symbol, from, to) {
  const ticker = yahooTicker(symbol);
  const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`, {
    params: { interval: '1d', period1: Date.parse(from) / 1000, period2: Date.parse(to) / 1000 + 86400 },
    timeout: 12000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024,
    headers: { 'User-Agent': 'TradeTally historical prices' }
  });
  const result = response.data?.chart?.result?.[0], quote = result?.indicators?.quote?.[0];
  verifyYahooListing(symbol,result?.meta);
  const first=Number(result.meta.firstTradeDate)||0;
  return (result?.timestamp || []).flatMap((time, i) => quote?.close?.[i] > 0 && Number.isFinite(time) && iso(time*1000)>=from && iso(time*1000)<=to && (!first||iso(time*1000)>=iso(first*1000))
    ? [{ time: Date.parse(iso(time * 1000)) / 1000, close: quote.close[i], open: quote.open?.[i] ?? quote.close[i], high: quote.high?.[i] ?? quote.close[i], low: quote.low?.[i] ?? quote.close[i], volume: quote.volume?.[i] || 0, currency:result.meta?.currency || null }] : []);
}

async function crypto(symbol, from, to) {
  const coin = await identity.resolve(symbol);
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
  return [...daily.values()];
}
module.exports = { missingRanges, yahoo, crypto, yahooTicker, verifyYahooListing };
