const axios = require('axios');
const db = require('../config/database');
const BrokerConnection = require('../models/BrokerConnection');
const etoro = require('./brokerSync/etoroService');
const { field } = require('./brokerSync/etoroService');
const DAY = 86400000;
const day = t => new Date(t).toISOString().slice(0, 10);
const queues = new Map(), directories = new Map(), cooldowns = new Map();

// One public-history lane per broker, shared across users, instruments and pages.
// Requests never contain private trade data. eToro reuses its credential-safe lane.
async function read(broker, url, params) {
  const pending = (queues.get(broker) || Promise.resolve()).catch(() => {}).then(async () => {
    if (Date.now() < (cooldowns.get(broker) || 0)) throw Error('Broker history cooling down');
    await new Promise(resolve => setTimeout(resolve, 2500));
    try {
      return (await axios.get(url, { params, timeout: 15000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024 })).data;
    } catch (error) {
      if (error.response?.status === 429) cooldowns.set(broker, Date.now() + Math.max(60, Number(error.response.headers?.['retry-after']) || 60) * 1000);
      throw Error('Broker historical prices unavailable'); // Never propagate request objects.
    }
  });
  queues.set(broker, pending);
  return pending;
}
async function directory(key, fetch) {
  const old = directories.get(key);
  if (old && Date.now() < old.expires) return old.value;
  const value = await fetch();
  directories.set(key, { value, expires: Date.now() + DAY });
  return value;
}
function candle(time, values) {
  const [open, high, low, close, volume] = values.map(Number);
  if (!Number.isFinite(time) || ![open, high, low, close].every(v => Number.isFinite(v) && v > 0)) return null;
  return { time: Date.parse(day(time)) / 1000, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
}
function bounded(rows, from, to) {
  const end = Math.min(Date.parse(to) + DAY, Date.parse(day(Date.now()))); // Finalized days only.
  return rows.filter(c => c && c.time * 1000 >= Date.parse(from) && c.time * 1000 < end);
}
async function kraken({ symbol, instrumentType, from, to }) {
  if (instrumentType !== 'crypto') return [];
  const pairs = await directory('kraken', async () => {
    const data = await read('kraken', 'https://api.kraken.com/0/public/AssetPairs', { assetVersion: 1 });
    if (data.error?.length || !data.result) throw Error('Invalid Kraken pair directory');
    return data.result;
  });
  const aliases = { BTC: 'XBT', DOGE: 'XDG' };
  const candidates = Object.entries(pairs).filter(([, p]) => {
    const [base, quote] = String(p.wsname || '').split('/');
    return [symbol, aliases[symbol]].includes(base) && quote === 'USD';
  });
  if (candidates.length !== 1) return [];
  const body = await read('kraken', 'https://api.kraken.com/0/public/OHLC', {
    pair: candidates[0][0], interval: 1440, since: Date.parse(from) / 1000
  });
  if (body.error?.length) throw Error('Kraken candles unavailable');
  const rows = Object.entries(body.result || {}).find(([k]) => k !== 'last')?.[1];
  if (!Array.isArray(rows)) throw Error('Invalid Kraken candles');
  return bounded(rows.map(r => candle(Number(r[0]) * 1000, [r[1], r[2], r[3], r[4], r[6]])), from, to);
}
async function okxPages(origin, path, params, from, to) {
  const result = []; let after = Date.parse(to) + DAY;
  for (let page = 0; page < 200; page++) {
    const data = await read('okx', origin + path, { ...params, bar: '1Dutc', limit: 100, after });
    if (data.code !== '0' || !Array.isArray(data.data)) throw Error('Invalid OKX candle response');
    if (!data.data.length) break;
    result.push(...data.data.filter(r => r.at(-1) === '1').map(r => candle(Number(r[0]), r.slice(1, 6))));
    const oldest = Math.min(...data.data.map(r => Number(r[0])));
    if (!Number.isFinite(oldest) || oldest >= after) throw Error('OKX candle pagination did not advance');
    if (oldest <= Date.parse(from)) return bounded(result, from, to);
    after = oldest;
    if (page === 199) throw Error('OKX candle page limit reached');
  }
  return bounded(result, from, to);
}
async function okx({ symbol, instrumentType, from, to, connection }) {
  if (instrumentType !== 'crypto') return [];
  const origins = { global: 'https://www.okx.com', eea: 'https://eea.okx.com', us: 'https://us.okx.com' };
  const origin = origins[connection.brokerEnvironment || 'global'];
  if (!origin) return [];
  const instruments = await directory(origin, async () => {
    const response = await read('okx', origin + '/api/v5/public/instruments', { instType: 'SPOT' });
    if (response.code !== '0' || !Array.isArray(response.data)) throw Error('Invalid OKX instruments');
    return response.data;
  });
  const markets = instruments.filter(p => p.baseCcy === symbol && ['USD', 'USDT'].includes(p.quoteCcy));
  const pair = markets.find(p => p.quoteCcy === 'USD') || markets.find(p => p.quoteCcy === 'USDT');
  if (!pair) return [];
  const rows = await okxPages(origin, '/api/v5/market/history-candles', { instId: pair.instId }, from, to);
  if (pair.quoteCcy === 'USD') return rows;
  // A USDT quote is not USD. Use the dated broker index, never assume parity.
  const rates = await directory(`okx-usdt:${from}:${to}:${origin}`, () => okxPages(origin,
    '/api/v5/market/history-index-candles', { instId: 'USDT-USD' }, from, to));
  const byDate = new Map(rates.map(c => [c.time, c.close]));
  return rows.filter(c => byDate.has(c.time)).map(c => {
    const rate = byDate.get(c.time);
    return { ...c, open: c.open * rate, high: c.high * rate, low: c.low * rate, close: c.close * rate };
  });
}
async function etoroCandles({ symbol, instrumentType, from, to, connection, userId }) {
  // Stock broker candles lack a documented split-adjustment/currency contract.
  // Do not mix them with adjusted equity history until that can be verified.
  if (instrumentType !== 'crypto') return [];
  const snapshot = (await db.query(`SELECT payload FROM broker_import_snapshots
    WHERE user_id=$1 AND connection_id=$2 AND broker_type='etoro'`, [userId, connection.id])).rows[0]?.payload;
  const matches = (snapshot?.instruments || []).filter(i => String(field(i, 'symbolFull')).toUpperCase() === symbol);
  if (matches.length !== 1) return [];
  const id = Number(field(matches[0], 'instrumentId'));
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  await etoro.get(connection, `/data/instruments/${id}/candles/coverage`, { interval: '1d' });
  const result = []; let cursor;
  for (let page = 0; page < 100; page++) {
    const data = await etoro.get(connection, `/data/instruments/${id}/candles`, {
      interval: '1d', from: from + 'T00:00:00Z', to: new Date(Date.parse(to) + DAY).toISOString(), limit: 2000, ...(cursor ? { cursor } : {})
    });
    if (Number(data.instrumentId) !== id || !Array.isArray(data.results)) throw Error('Invalid eToro candles');
    // Accept an explicit USD quotation only; ambiguous units fall through.
    if (!String(data.symbol || '').endsWith('/USD')) return [];
    result.push(...data.results.map(r => candle(Date.parse(r.time), [r.open, r.high, r.low, r.close, r.volume])));
    if (!data.pagination?.hasNext) return bounded(result, from, to);
    if (!data.pagination.nextCursor || cursor === data.pagination.nextCursor) throw Error('eToro candle cursor did not advance');
    cursor = data.pagination.nextCursor;
  }
  throw Error('eToro candle page limit reached');
}

// Register a new broker capability here; callers, queue and UI need no broker switch.
const adapters = new Map([['kraken', kraken], ['okx', okx], ['etoro', etoroCandles]]);
async function fetch({ userId, symbol, instrumentType, ranges, onPrices }) {
  if (instrumentType !== 'crypto') return;
  const connections = (await db.query(`SELECT id,broker_type FROM broker_connections
    WHERE user_id=$1 AND connection_status='active' ORDER BY created_at`, [userId])).rows;
  for (const row of connections) {
    const adapter = adapters.get(row.broker_type);
    if (!adapter) continue;
    try {
      const connection = await BrokerConnection.findById(row.id, row.broker_type === 'etoro');
      for (const { from, to } of ranges()) {
        const prices = await adapter({ userId, symbol, instrumentType, from, to, connection });
        if (prices.length) await onPrices(prices, row.broker_type);
      }
    } catch { /* Provider fallback handles unavailable permissions, pairs or dates. */ }
  }
}
module.exports = { fetch, adapters, bounded, candle, kraken, okx, etoroCandles };
