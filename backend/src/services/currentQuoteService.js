const brokers = require('./brokerQuoteProviders');
const finnhub = require('../utils/finnhubClient');
const schwab = require('../utils/schwabMarketData');
const yahoo = require('../utils/yahooFinance');
const { convertQuoteCurrency } = require('../utils/quoteCurrency');
const inFlight = new Map();
const {fresh,newer} = require('../utils/quoteFreshness');

async function getQuote(symbol, instrumentType = 'stock') {
  const key = instrumentType + ':' + symbol;
  if (inFlight.has(key)) return inFlight.get(key);
  const work = (async () => {
    const broker = await brokers.fetch(symbol, instrumentType).catch(() => null);
    if (broker && fresh(broker)) return broker;
    let best=broker;
    if (instrumentType === 'crypto') {
      try {
        const quote = await finnhub.getCryptoQuote(symbol);
        best=newer(quote && { ...quote, currency: 'USD', source: 'coingecko',
          ...(Number(quote.t) > 0 ? {asOf:new Date(Number(quote.t)*1000).toISOString()} : {}) },best);
      } catch { /* Retain the original broker quote when no fresher source exists. */ }
      if (best) return best;
      throw Error('Current quote unavailable from supported sources');
    }
    const steps = [
      ['finnhub', () => finnhub.getQuote(symbol, { source: 'price_monitoring', priority: 6, background: true, maxQueueWaitMs: 0 })],
      ['schwab', () => schwab.getQuote(symbol)],
      ['yahoo', () => yahoo.getQuote(symbol)]
    ];
    let capacityError;
    for (const [source, fetch] of steps) {
      try {
        let quote = await fetch();
        if (!(Number(quote?.c) > 0)) continue;
        // Finnhub/Schwab US tickers use USD. Foreign Yahoo quotes must state
        // their native unit and be normalized before entering the USD cache.
        if (!quote.currency && source !== 'yahoo' && /^[A-Z0-9^-]+(?:[.-][AB])?$/.test(symbol)) quote = { ...quote, currency: 'USD' };
        quote = await convertQuoteCurrency(quote, 'USD');
        const candidate={ ...quote, source,
          ...(Number(quote.t) > 0 ? {asOf:new Date(Number(quote.t)*1000).toISOString()} : {}) };
        best=newer(candidate,best);
        if (fresh(best)) return best;
      } catch (error) {
        if (['FINNHUB_SCHEDULER_SKIPPED','FINNHUB_SCHEDULER_TIMEOUT'].includes(error?.code)) capacityError = error;
        // Proceed through every supported fallback, not only HTTP 403.
      }
    }
    if (best) return best;
    throw capacityError || Error('Current quote unavailable from supported sources');
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}
module.exports = { getQuote };
