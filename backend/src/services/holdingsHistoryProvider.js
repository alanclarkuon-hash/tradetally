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

async function yahoo(symbol, from, to) {
  const ticker = symbol === 'BRK.B' ? 'BRK-B' : symbol;
  const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`, {
    params: { interval: '1d', period1: Date.parse(from) / 1000, period2: Date.parse(to) / 1000 + 86400 },
    timeout: 12000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024,
    headers: { 'User-Agent': 'TradeTally historical prices' }
  });
  const result = response.data?.chart?.result?.[0], quote = result?.indicators?.quote?.[0];
  return (result?.timestamp || []).flatMap((time, i) => quote?.close?.[i] > 0
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
module.exports = { missingRanges, yahoo, crypto };
