const db = require('../config/database');
const BrokerConnection = require('../models/BrokerConnection');
const etoro = require('./brokerSync/etoroService');
const { field } = require('./brokerSync/etoroService');
const { read, directory } = require('./brokerMarketData');
const positionCache = new Map();
const positionRequests = new Map();
async function trading212Quote({ symbol, instrumentType, connection }) {
  if (!['stock','etf'].includes(instrumentType)) return null;
  let saved = positionCache.get(connection.id);
  if (!saved || saved.expires <= Date.now()) {
    if (!positionRequests.has(connection.id)) {
      const request=(async()=>{
        const positions=await require('./brokerSync/trading212Service').fetchPositions(connection,{background:true});
        if (!positions) return null;
        const result={positions,asOf:new Date().toISOString(),expires:Date.now()+30000};
        positionCache.set(connection.id,result);
        return result;
      })().finally(()=>positionRequests.delete(connection.id));
      positionRequests.set(connection.id,request);
    }
    saved=await positionRequests.get(connection.id);
    if (!saved) return null;
  }
  const old = (await db.query('SELECT positions FROM broker_portfolio_snapshots WHERE connection_id=$1', [connection.id])).rows[0]?.positions || [];
  const { currentSymbol } = require('./brokerSync/trading212Instruments');
  const matches = saved.positions.filter(p => {
    const instrument = p.instrument || {}, prior = old.find(o => o.instrument?.ticker === instrument.ticker)?.instrument;
    if (prior?.isin && instrument.isin && prior.isin !== instrument.isin) return false;
    return currentSymbol({ ...prior, ...instrument, shortName: instrument.shortName || prior?.shortName }) === symbol;
  });
  if (matches.length !== 1) return null;
  const p = matches[0];
  const converted = await require('../utils/quoteCurrency').convertQuoteCurrency({ c: Number(p.currentPrice), currency: p.instrument?.currency }, 'USD');
  return quote(converted.c, 'broker:trading212', saved.asOf);
}

function quote(price, source, asOf = new Date().toISOString()) {
  const c = Number(price), time = Date.parse(asOf);
  return Number.isFinite(c) && c > 0 && Number.isFinite(time) && time <= Date.now() + 60000
    ? { c, currency: 'USD', source, asOf: new Date(time).toISOString() } : null;
}
async function etoroQuote({ symbol, instrumentType, connection }) {
  const payload = (await db.query(`SELECT payload FROM broker_import_snapshots
    WHERE connection_id=$1 AND broker_type='etoro'`, [connection.id])).rows[0]?.payload;
  let instruments = (payload?.instruments || []).filter(i => String(field(i, 'symbolFull')).toUpperCase() === symbol);
  if (!instruments.length) {
    instruments = await directory('etoro-quote:' + symbol, async () => {
      const data = await etoro.get(connection, '/market-data/search', {
        fields: 'instrumentId,internalSymbolFull,instrumentTypeID', internalSymbolFull: symbol, pageSize: 100, pageNumber: 1
      }, { background: true });
      return (data?.items || []).filter(i => String(field(i, 'internalSymbolFull')).toUpperCase() === symbol);
    });
  }
  if (instruments?.length !== 1) return null;
  const item = instruments[0], id = Number(field(item, 'instrumentId'));
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const types = payload?.instrumentTypes || await directory('etoro-quote-types', async () =>
    field(await etoro.get(connection, '/market-data/instrument-types', undefined, { background: true }), 'instrumentTypes'));
  const description = String(field(types?.find(t => String(field(t, 'instrumentTypeId')) === String(field(item, 'instrumentTypeId'))), 'instrumentTypeDescription') || '').toLowerCase();
  if (!description || (instrumentType === 'crypto' ? !/crypto/.test(description) : !/stock|equity|etf|fund/.test(description))) return null;
  const body = await etoro.get(connection, '/market-data/instruments/rates', { instrumentIds: String(id) }, { background: true });
  const rates = field(body, 'rates');
  const rate = Array.isArray(rates) ? rates.find(r => Number(field(r, 'instrumentID')) === id) : null;
  // Broker supplies an explicit instrument-unit -> USD conversion, including
  // non-US listings. Do not assume native bid prices are USD or stablecoin parity.
  const conversion = Number(field(rate, 'conversionRateBid'));
  if (!(conversion > 0) || !field(rate, 'date')) return null;
  return quote(Number(field(rate, 'bid')) * conversion, 'broker:etoro', field(rate, 'date'));
}
async function krakenQuote({ symbol, instrumentType }) {
  if (instrumentType !== 'crypto') return null;
  const pairs = await directory('kraken-pairs', async () => {
    const data = await read('kraken', 'https://api.kraken.com/0/public/AssetPairs', { assetVersion: 1 }, { background: true });
    return data && !data.error?.length ? data.result : null;
  });
  const aliases = { BTC: 'XBT', DOGE: 'XDG' };
  const matches = Object.entries(pairs || {}).filter(([, p]) => {
    const [base, unit] = String(p.wsname || '').split('/');
    return [symbol, aliases[symbol]].includes(base) && unit === 'USD' && (!p.aclass_base || p.aclass_base === 'currency');
  });
  if (matches.length !== 1) return null;
  const data = await read('kraken', 'https://api.kraken.com/0/public/Ticker', { pair: matches[0][0] }, { background: true });
  if (data?.error?.length) return null;
  return quote(data?.result?.[matches[0][0]]?.c?.[0], 'broker:kraken');
}
async function okxQuote({ symbol, instrumentType, connection }) {
  if (instrumentType !== 'crypto') return null;
  const origin = { global: 'https://www.okx.com', eea: 'https://eea.okx.com', us: 'https://us.okx.com' }[connection.brokerEnvironment || 'global'];
  if (!origin) return null;
  const instruments = await directory('okx-spot:' + origin, async () => {
    const data = await read('okx', origin + '/api/v5/public/instruments', { instType: 'SPOT' }, { background: true });
    return data?.code === '0' ? data.data : null;
  });
  const matches = (instruments || []).filter(p => p.baseCcy === symbol && ['USD', 'USDT'].includes(p.quoteCcy) && p.state === 'live');
  const pair = matches.find(p => p.quoteCcy === 'USD') || matches.find(p => p.quoteCcy === 'USDT');
  if (!pair) return null;
  const body = await read('okx', origin + '/api/v5/market/ticker', { instId: pair.instId }, { background: true });
  const ticker = body?.code === '0' && body.data?.find(r => r.instId === pair.instId && r.instType === 'SPOT');
  if (!ticker) return null;
  let conversion = 1;
  if (pair.quoteCcy === 'USDT') {
    const index = await read('okx', origin + '/api/v5/market/index-tickers', { instId: 'USDT-USD' }, { background: true });
    const row = index?.code === '0' && index.data?.find(r => r.instId === 'USDT-USD');
    if (!row || Math.abs(Number(row.ts) - Number(ticker.ts)) > 60000) return null;
    conversion = Number(row.idxPx);
    if (!(conversion > 0)) return null;
  }
  return quote(Number(ticker.last) * conversion, 'broker:okx', new Date(Number(ticker.ts)).toISOString());
}

// New broker support is one registered capability, not switches in each consumer.
const adapters = new Map([['etoro', etoroQuote], ['kraken', krakenQuote], ['okx', okxQuote], ['trading212', trading212Quote]]);
const cached = new Map(), inFlight = new Map();
async function fetch(symbol, instrumentType) {
  const key = instrumentType + ':' + symbol;
  const old = cached.get(key);
  if (old && old.expires > Date.now()) return old.value;
  if (inFlight.has(key)) return inFlight.get(key);
  const work = (async () => {
    const rows = (await db.query(`SELECT id,broker_type FROM broker_connections
      WHERE connection_status='active' ORDER BY created_at`)).rows;
    for (const row of rows) {
      const adapter = adapters.get(row.broker_type);
      if (!adapter) continue;
      try {
        const connection = await BrokerConnection.findById(row.id, ['etoro','trading212'].includes(row.broker_type));
        const result = await adapter({ symbol, instrumentType, connection });
        if (result?.c > 0 && result.currency === 'USD') {
          cached.set(key, { value: result, expires: Date.now() + 30000 });
          return result;
        }
      } catch { /* Sanitized fallback; credentials never leave the adapter. */ }
    }
    cached.set(key, { value: null, expires: Date.now() + 30000 });
    return null;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}
module.exports = { fetch, adapters, etoroQuote, krakenQuote, okxQuote, trading212Quote, quote };
