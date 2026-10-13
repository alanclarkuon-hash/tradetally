const { read, directory } = require('./brokerMarketData');
const db = require('../config/database');
const BrokerConnection = require('../models/BrokerConnection');
const etoro = require('./brokerSync/etoroService');
const { field } = require('./brokerSync/etoroService');
const DAY = 86400000;
const cryptoUnits=require('./cryptoPriceUnits');
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
  const quote=cryptoUnits.underlying(symbol);
  const aliases = { BTC: 'XBT', DOGE: 'XDG' };
  const candidates = Object.entries(pairs).filter(([, p]) => {
    const [base, currency] = String(p.wsname || '').split('/');
    return [quote.symbol,aliases[quote.symbol]].includes(base) && currency === 'USD';
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
  const live=bounded(rows.slice(0,-1).map(r => candle(Number(r[0]) * 1000, [r[1], r[2], r[3], r[4], r[6]])), from, to);
  const archiveTo=to<'2026-06-30'?to:'2026-06-30';
  const missing=from<=archiveTo&&require('./holdingsHistoryProvider').missingRanges(live,from,archiveTo,true).length;
  if(missing) {
    const combined=new Map(live.map(c=>[c.time,c]));
    for(const segment of cryptoUnits.archiveSegments(symbol,from,archiveTo))try {
      const pair=segment.symbol===quote.symbol?String(candidates[0][1].wsname).replace('/',''):segment.symbol+'USD';
      const archive=await directory('kraken-ohlcvt:'+pair,()=>require('./brokerSync/krakenArchivePrices').dailyPrices(pair));
      for(const c of bounded(archive.candles||[],segment.from,segment.to))if(!combined.has(c.time))combined.set(c.time,c);
    }catch{/* A missing predecessor archive cannot remove other valid coverage. */}
    return cryptoUnits.scale([...combined.values()].sort((a,b)=>a.time-b.time),quote.units);
  }
  return cryptoUnits.scale(live,quote.units);
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
  const quote=cryptoUnits.underlying(symbol);
  const markets = instruments.filter(p => p.baseCcy === quote.symbol && ['USD', 'USDT'].includes(p.quoteCcy));
  const pair = markets.find(p => p.quoteCcy === 'USD') || markets.find(p => p.quoteCcy === 'USDT');
  if (!pair) return [];
  const rows = await okxPages(origin, '/api/v5/market/history-candles', { instId: pair.instId }, from, to);
  if (pair.quoteCcy === 'USD') return cryptoUnits.scale(rows,quote.units);
  // A USDT quote is not USD. Use the dated broker index, never assume parity.
  const rates = await directory(`okx-usdt:${from}:${to}:${origin}`, () => okxPages(origin,
    '/api/v5/market/history-index-candles', { instId: 'USDT-USD' }, from, to));
  const byDate = new Map(rates.map(c => [c.time, c.close]));
  return cryptoUnits.scale(rows.filter(c => byDate.has(c.time)).map(c => {
    const rate = byDate.get(c.time);
    return { ...c, open: c.open * rate, high: c.high * rate, low: c.low * rate, close: c.close * rate };
  }),quote.units);
}
async function etoroSearch(connection,symbol) {
 const matches=[],seen=new Set();
 for(let page=1;page<=10;page++) {
  const data=await etoro.get(connection,'/market-data/search',{
   fields:'instrumentId,internalSymbolFull',internalSymbolFull:symbol,pageSize:100,page
  });
  if(!Array.isArray(data.items)||data.page!=null&&Number(data.page)!==page)throw Error('Invalid eToro search page');
  const total=Number(data.totalItems??data.items.length);
  if(!Number.isSafeInteger(total)||total<0||total>1000)throw Error('Unbounded eToro search');
  for(const item of data.items) {
   const id=String(field(item,'instrumentId'));
   if(id==='undefined'||seen.has(id))throw Error('eToro search pages overlap');
   seen.add(id);
   if(String(field(item,'internalSymbolFull')).toUpperCase()===symbol)matches.push(item);
  }
  if(seen.size>=total)return matches;
  if(!data.items.length)throw Error('Incomplete eToro search');
 }
 throw Error('eToro search page limit reached');
}
async function etoroArchivedEquities(connection,symbol) {
 const metadata=await directory('etoro-history-archived-equities',async()=>{
  const response=await etoro.get(connection,'/market-data/exchanges');
  const venues=field(response,'exchangeInfo');
  if(!Array.isArray(venues)||!venues.length||venues.length>64)throw Error('Invalid eToro venues');
  const ids=venues.map(v=>Number(field(v,'exchangeId')));
  if(ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)throw Error('Invalid eToro venue identities');
  const instruments=new Map();
  for(const exchangeId of ids) {
   const response=await etoro.get(connection,'/market-data/instruments',{instrumentTypeIds:'5,6',exchangeIds:String(exchangeId)});
   const rows=field(response,'instrumentDisplayDatas');
   if(!Array.isArray(rows))throw Error('Invalid eToro equity directory');
   for(const row of rows) {
    const instrumentId=Number(field(row,'instrumentId')),type=Number(field(row,'instrumentTypeId')),symbolFull=field(row,'symbolFull');
    if(!Number.isSafeInteger(instrumentId)||instrumentId<=0||![5,6].includes(type)||Number(field(row,'exchangeId'))!==exchangeId||typeof symbolFull!=='string'||!symbolFull)throw Error('Invalid eToro archived identity');
    if(instruments.has(instrumentId))throw Error('Duplicate eToro archived identity');
    instruments.set(instrumentId,{instrumentId,instrumentTypeId:type,symbolFull,exchangeId});
   }
  }
  return [...instruments.values()];
 });
 return metadata.filter(m=>m.symbolFull.toUpperCase()===symbol);
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
      const found=await etoroSearch(connection,symbol);
      if(!found.length&&instrumentType!=='crypto')return etoroArchivedEquities(connection,symbol);
      if(found.length!==1)return [];
      const id=Number(field(found[0],'instrumentId'));
      if(!Number.isSafeInteger(id)||id<=0)return [];
      // Search projections omit instrument type. Verify the separate typed
      // display metadata before requesting native history for a closed asset.
      const metadata=await etoro.get(connection,'/market-data/instruments',{instrumentIds:String(id)});
      return (field(metadata,'instrumentDisplayDatas')||[]).filter(i=>Number(field(i,'instrumentId'))===id&&String(field(i,'symbolFull')).toUpperCase()===symbol);
    });
  }
  if (matches.length !== 1) return [];
  const types=snapshot?.instrumentTypes||await directory('etoro-history-types',async()=>
    field(await etoro.get(connection,'/market-data/instrument-types'),'instrumentTypes'));
  const typeId=field(matches[0],'instrumentTypeId');
  const description=String(field(types?.find(t=>String(field(t,'instrumentTypeId'))===String(typeId)),'instrumentTypeDescription')||'').toLowerCase();
  if(!description||(instrumentType==='crypto'?!/crypto/.test(description):!/stock|equity|etf|fund/.test(description)))return [];
  const id = Number(field(matches[0], 'instrumentId'));
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  const coverage=await etoro.get(connection, `/data/instruments/${id}/candles/coverage`);
  if(Number(coverage.instrumentId)!==id || !Array.isArray(coverage.intervals)) throw Error('Invalid eToro coverage');
  const interval=instrumentType==='crypto'&&coverage.intervals.some(i=>i.interval==='1h'&&Number(i.candles)>0)?'1h':'1d';
  if(!coverage.intervals.some(i=>i.interval===interval&&Number(i.candles)>0))return [];
  const reference=instrumentType==='crypto'?null:(await db.query('SELECT payload FROM portfolio_reconstruction_prices WHERE symbol=$1',[symbol])).rows[0]?.payload;
  const result = []; let cursor;
  for (let page = 0; page < 100; page++) {
    const data = await etoro.get(connection, `/data/instruments/${id}/candles`, {
      interval, from: new Date(Date.parse(from)-DAY).toISOString(), to: new Date(Date.parse(to) + DAY).toISOString(), limit: 2000,
      side:'bid',format:'verbose', ...(cursor ? { cursor } : {})
    });
    if (Number(data.instrumentId) !== id || !Array.isArray(data.results)) throw Error('Invalid eToro candles');
    if(data.interval!==interval||data.side!=='bid')throw Error('Invalid eToro candle interval');
    const quote=String(data.symbol||'').split('/');
    if(data.results.length && (quote.length!==2 || quote[0].toUpperCase()!==symbol)) throw Error('Invalid eToro candle identity');
    if(interval==='1h'&&quote[1]!=='USD'&&data.results.length)throw Error('Invalid eToro crypto currency');
    result.push(...(interval==='1h'?data.results:data.results.map(r => etoroDaily(r,instrumentType,quote[1],reference))));
    if (!data.pagination?.hasNext) return bounded(interval==='1h'?etoroCryptoDays(result):result, from, to);
    if (!data.pagination.nextCursor || cursor === data.pagination.nextCursor) throw Error('eToro candle cursor did not advance');
    cursor = data.pagination.nextCursor;
  }
  throw Error('eToro candle page limit reached');
}

function etoroCryptoDays(rows) {
 const groups=new Map();
 for(const row of rows) {
  const time=Date.parse(row.time);
  if(!Number.isFinite(time))continue;
  const date=day(time),group=groups.get(date)||{hours:new Map(),invalid:false};groups.set(date,group);
  if(time%3600000!==0){group.invalid=true;continue;}
  const values=[row.open,row.high,row.low,row.close].map(Number),volume=Number(row.volume??0);
  const [open,high,low,close]=values;
  if(!values.every(v=>Number.isFinite(v)&&v>0)||low>Math.min(open,close)||high<Math.max(open,close)||low>high||!Number.isFinite(volume)||volume<0){group.invalid=true;continue;}
  const c={time,open,high,low,close,volume},old=group.hours.get(time);
  if(old&&JSON.stringify(old)!==JSON.stringify(c))group.invalid=true;
  group.hours.set(time,c);
 }
 const result=[];
 for(const [date,g] of groups) {
  if(g.invalid||g.hours.size!==24)continue;
  const hours=[...g.hours.values()].sort((a,b)=>a.time-b.time),start=Date.parse(date);
  if(!hours.every((c,i)=>c.time===start+i*3600000))continue;
  const volume=hours.reduce((n,c)=>n+c.volume,0);if(!Number.isFinite(volume))continue;
  result.push({time:start/1000,open:hours[0].open,high:Math.max(...hours.map(c=>c.high)),low:Math.min(...hours.map(c=>c.low)),close:hours[23].close,volume,currency:'USD'});
 }
 return result.sort((a,b)=>a.time-b.time);
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
  return {time:Date.parse(session)/1000,close:normalized,open:normalized,high:normalized,low:normalized,volume:0,currency:unit.code};
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
        if (prices.length) await onPrices(prices.map(c=>({...c,currency:c.currency||(instrumentType==='crypto'?'USD':null)})), row.broker_type);
      }
    } catch { /* Provider fallback handles unavailable permissions, pairs or dates. */ }
  }
}
module.exports = { fetch, adapters, bounded, candle, kraken, okx, etoroCandles, etoroDaily, etoroCryptoDays, etoroSearch, etoroArchivedEquities };
