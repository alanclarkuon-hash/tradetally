const { read, directory } = require('./brokerMarketData');
const db = require('../config/database');
const BrokerConnection = require('../models/BrokerConnection');
const etoro = require('./brokerSync/etoroService');
const { field } = require('./brokerSync/etoroService');
const DAY = 86400000;
const day = t => new Date(t).toISOString().slice(0, 10);
function candle(time, values) {
  const [open, high, low, close, volume] = values.map(Number);
  if (!Number.isFinite(time) || time % DAY !== 0 || ![open, high, low, close].every(v => Number.isFinite(v) && v > 0) || low>Math.min(open,close) || high<Math.max(open,close) || low>high) return null;
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
  // Kraken explicitly marks the final row as the unfinished candle even when
  // an inactive market's last period predates today. Never infer commitment by date.
  return bounded(rows.slice(0,-1).map(r => candle(Number(r[0]) * 1000, [r[1], r[2], r[3], r[4], r[6]])), from, to);
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
  if (!['crypto','stock','etf'].includes(instrumentType)) return [];
  const snapshot = (await db.query(`SELECT payload FROM broker_import_snapshots
    WHERE user_id=$1 AND connection_id=$2 AND broker_type='etoro'`, [userId, connection.id])).rows[0]?.payload;
  let matches = (snapshot?.instruments || []).filter(i => String(field(i, 'symbolFull')).toUpperCase() === symbol);
  if (!matches.length) {
    // Older closed holdings may be absent from the current account snapshot.
    // Search is public metadata, but its filter can be ignored: verify exact identity.
    matches = await directory(`etoro-identity:${symbol}`,async()=>{
      const data=await etoro.get(connection,'/market-data/search',{
        fields:'instrumentId,internalSymbolFull',internalSymbolFull:symbol,pageSize:100,pageNumber:1
      });
      return (data.items||[]).filter(i=>String(field(i,'internalSymbolFull')).toUpperCase()===symbol);
    });
  }
  if (matches.length !== 1) return [];
  const id = Number(field(matches[0], 'instrumentId'));
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  const coverage=await etoro.get(connection, `/data/instruments/${id}/candles/coverage`);
  if(Number(coverage.instrumentId)!==id || !Array.isArray(coverage.intervals)) throw Error('Invalid eToro coverage');
  if(!coverage.intervals.some(i=>i.interval==='1d'&&Number(i.candles)>0))return [];
  const reference=instrumentType==='crypto'?null:(await db.query('SELECT payload FROM portfolio_reconstruction_prices WHERE symbol=$1',[symbol])).rows[0]?.payload;
  const result = []; let cursor;
  for (let page = 0; page < 100; page++) {
    const data = await etoro.get(connection, `/data/instruments/${id}/candles`, {
      interval: '1d', from: new Date(Date.parse(from)-DAY).toISOString(), to: new Date(Date.parse(to) + DAY).toISOString(), limit: 2000,
      side:'bid',format:'verbose', ...(cursor ? { cursor } : {})
    });
    if (Number(data.instrumentId) !== id || !Array.isArray(data.results)) throw Error('Invalid eToro candles');
    if(data.interval!=='1d'||data.side!=='bid')throw Error('Invalid eToro candle interval');
    const quote=String(data.symbol||'').split('/');
    if(data.results.length && (quote.length!==2 || quote[0].toUpperCase()!==symbol)) throw Error('Invalid eToro candle identity');
    result.push(...data.results.map(r => etoroDaily(r,instrumentType,quote[1],reference)));
    if (!data.pagination?.hasNext) return bounded(result, from, to);
    if (!data.pagination.nextCursor || cursor === data.pagination.nextCursor) throw Error('eToro candle cursor did not advance');
    cursor = data.pagination.nextCursor;
  }
  throw Error('eToro candle page limit reached');
}

function etoroDaily(row,type,currency,reference) {
  const time=Date.parse(row.time),hour=new Date(time).getUTCHours();
  if(!Number.isFinite(time))return null;
  if(type==='crypto') {
    // eToro's evening-open 24h bars are not UTC daily closes. Do not relabel
    // them as UTC prices; Kraken/OKX/CoinGecko remain valid fallbacks.
    if(currency!=='USD'||time%DAY!==0)return null;
    return candle(time,[row.open,row.high,row.low,row.close,row.volume]);
  }
  // The Data API does not declare equity split adjustment. Validate each
  // close against already stored dated, split-aware reference evidence.
  // This also detects mixed-scale OHLC rows without polluting finalized data.
  const unit=require('../utils/quoteCurrency').normaliseMinorUnit(currency);
  if(!unit||unit.code!==reference?.currency || ![0,21,22].includes(hour))return null;
  const session=day(time+(hour===0?0:DAY)),price=reference.prices?.find(p=>p.date===session);
  if(!(price?.close>0))return null;
  const split=(reference.splits||[]).filter(s=>s.date>session).reduce((n,s)=>n*s.ratio,1);
  if(!(split>0))return null;
  const target=price.close/split,close=Number(row.close)/unit.divisor;
  // Accept either demonstrated raw-share or split-adjusted quotation. Other
  // corporate actions, currency conflicts or materially different quotes fall through.
  const values=[close,close/split].filter(v=>v>0&&Math.abs(v/target-1)<=0.01);
  if(!values.length)return null;
  const normalized=values.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0];
  return {time:Date.parse(session)/1000,close:normalized,open:normalized,high:normalized,low:normalized,volume:0};
}

// Register a new broker capability here; callers, queue and UI need no broker switch.
const adapters = new Map([['kraken', kraken], ['okx', okx], ['etoro', etoroCandles]]);
async function fetch({ userId, symbol, instrumentType, ranges, onPrices }) {
  const connections = (await db.query(`SELECT id,broker_type FROM broker_connections
    WHERE user_id=$1 AND connection_status='active' ORDER BY created_at`, [userId])).rows;
  for (const row of connections) {
    if(!ranges().length)break;
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
module.exports = { fetch, adapters, bounded, candle, kraken, okx, etoroCandles, etoroDaily };
