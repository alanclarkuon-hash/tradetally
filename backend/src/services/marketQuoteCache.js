const db = require('../config/database');
const {priceCacheKey} = require('../utils/priceCacheIdentity');
const {convertQuoteCurrency} = require('../utils/quoteCurrency');

function number(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}
async function save(symbol, instrumentType, quote, fallbackSource='market_data') {
  if (!(number(quote?.c)>0)) return false;
  const currency=quote.currency || (instrumentType==='crypto' || /^[A-Z0-9^-]+(?:[.-][AB])?$/.test(symbol) ? 'USD' : null);
  const normalized=await convertQuoteCurrency({...quote,currency},'USD');
  const asOf=quote.asOf || (number(quote.t)>0 ? new Date(Number(quote.t)*1000).toISOString() : new Date().toISOString());
  if (!Number.isFinite(Date.parse(asOf)) || Date.parse(asOf)>Date.now()+60000) return false;
  let source=quote.source || fallbackSource;
  if (source.startsWith('broker:') && !/:(crypto|stock)$/.test(source)) source+=instrumentType==='crypto'?':crypto':':stock';
  if (instrumentType==='crypto' && !source.startsWith('broker:')) source='coingecko';
  const key=priceCacheKey(symbol,instrumentType);
  const previous=number(normalized.pc)>0 ? number(normalized.pc) : null;
  const change=number(normalized.d) ?? (previous!==null ? normalized.c-previous : null);
  const percent=number(normalized.dp) ?? (previous!==null ? change/previous*100 : null);
  const result=await db.query(`INSERT INTO price_monitoring
    (symbol,current_price,previous_price,price_change,percent_change,high_of_day,low_of_day,open_price,volume,data_source,last_updated)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(symbol) DO UPDATE SET
      current_price=EXCLUDED.current_price,previous_price=EXCLUDED.previous_price,
      price_change=EXCLUDED.price_change,percent_change=EXCLUDED.percent_change,
      high_of_day=EXCLUDED.high_of_day,low_of_day=EXCLUDED.low_of_day,
      open_price=EXCLUDED.open_price,volume=EXCLUDED.volume,
      data_source=EXCLUDED.data_source,last_updated=EXCLUDED.last_updated
    WHERE price_monitoring.last_updated IS NULL OR price_monitoring.last_updated<EXCLUDED.last_updated
      OR (price_monitoring.last_updated=EXCLUDED.last_updated AND EXCLUDED.data_source LIKE 'broker:%' AND price_monitoring.data_source NOT LIKE 'broker:%')
    RETURNING symbol`,[key,normalized.c,previous,change,percent,number(normalized.h),number(normalized.l),number(normalized.o),number(normalized.v),source,asOf]);
  if (result.rowCount===0) return false;
  try { await require('../utils/historicalPriceCache').upsertToday(key,{...normalized,asOf},source); }
  catch { require('../utils/logger').warn('Current quote saved; provisional daily cache write failed'); }
  return true;
}
module.exports={save};
