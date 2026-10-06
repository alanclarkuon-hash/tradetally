const db = require('../config/database');
const cacheKey = symbol => /^crypto:/i.test(symbol) ? 'crypto:'+symbol.slice(7).toUpperCase() : symbol.toUpperCase();

/**
 * Persistent historical price cache backed by the historical_prices table.
 * Stores OHLCV daily candles so they only need to be fetched from external APIs once.
 */

/**
 * Get cached candles for a symbol within a date range.
 * @param {string} symbol
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<Array>} Array of {time, open, high, low, close, volume}
 */
async function getRange(symbol, startDate, endDate) {
  const result = await db.query(
    `SELECT price_date, open, high, low, close, volume
     FROM historical_prices
     WHERE symbol = $1 AND price_date BETWEEN $2 AND $3 AND (is_final OR price_date=CURRENT_DATE)
     ORDER BY price_date ASC`,
    [cacheKey(symbol), startDate, endDate]
  );

  return result.rows.map(row => ({
    time: Math.floor(new Date(row.price_date).getTime() / 1000),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseInt(row.volume) || 0
  }));
}

/**
 * Check if we have sufficient coverage for a date range.
 * "Sufficient" means we have at least 50% of calendar days covered,
 * accounting for weekends and holidays.
 * @param {string} symbol
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
async function hasRange(symbol, startDate, endDate) {
  const result = await db.query(
    `SELECT COUNT(*) as count
     FROM historical_prices
     WHERE symbol = $1 AND price_date BETWEEN $2 AND $3 AND is_final`,
    [cacheKey(symbol), startDate, endDate]
  );

  const count = parseInt(result.rows[0].count);
  if (count === 0) return false;

  // Calculate calendar days in range
  const start = new Date(startDate);
  const end = new Date(endDate);
  const calendarDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  // Expect roughly 5/7 of calendar days to be trading days, then require 50% of that
  const expectedTradingDays = Math.max(1, Math.floor(calendarDays * 5 / 7));
  const threshold = Math.max(1, Math.floor(expectedTradingDays * 0.5));

  return count >= threshold;
}

/**
 * Bulk insert candles (immutable historical data).
 * Finalized rows are immutable; provisional live quotes can be finalized.
 * @param {string} symbol
 * @param {Array} candles - Array of {time, open, high, low, close, volume}
 * @param {string} dataSource - e.g. 'alphavantage', 'finnhub'
 */
async function insertCandles(symbol, candles, dataSource) {
  if (!candles || candles.length === 0) return;
  if (candles.length > 1000) {
    for (let offset=0; offset<candles.length; offset+=1000) await insertCandles(symbol, candles.slice(offset,offset+1000), dataSource);
    return;
  }

  const symbolUpper = cacheKey(symbol);

  // Build bulk INSERT with VALUES list
  const values = [];
  const placeholders = [];
  let paramIndex = 1;

  for (const candle of candles) {
    // Convert unix timestamp to date string
    const date = new Date(candle.time * 1000);
    const dateStr = date.toISOString().split('T')[0];

    placeholders.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8})`
    );
    values.push(
      symbolUpper,
      dateStr,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      // FMP occasionally reports fractional volumes; the column is BIGINT
      Math.round(Number(candle.volume) || 0),
      dataSource,
      dateStr < new Date().toISOString().slice(0, 10)
    );
    paramIndex += 9;
  }

  const query = `
    INSERT INTO historical_prices (symbol, price_date, open, high, low, close, volume, data_source, is_final)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (symbol, price_date) DO UPDATE SET
      open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,
      volume=EXCLUDED.volume,data_source=EXCLUDED.data_source,is_final=EXCLUDED.is_final,updated_at=NOW()
    WHERE NOT historical_prices.is_final AND (EXCLUDED.is_final OR historical_prices.observed_at IS NULL)
  `;

  await db.query(query, values);
  console.log(`[PRICE-CACHE] Inserted ${candles.length} candles for ${symbolUpper} from ${dataSource}`);
}

/**
 * Upsert today's price data (live price that keeps updating throughout the day).
 * Uses ON CONFLICT DO UPDATE since today's data changes during market hours.
 * @param {string} symbol
 * @param {Object} priceData - {open, high, low, close} (any subset)
 * @param {string} dataSource - e.g. 'finnhub', 'price_monitor'
 */
async function upsertToday(symbol, priceData, dataSource) {
  const symbolUpper = cacheKey(symbol);
  const today = new Date().toISOString().split('T')[0];
  const asOf=priceData.asOf || (Number(priceData.t)>0 ? new Date(Number(priceData.t)*1000).toISOString() : new Date().toISOString());
  // A cached last close is not a candle for a later trading date.
  if (!Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0,10)!==today) return;

  const open = priceData.open ?? priceData.o ?? null;
  const high = priceData.high ?? priceData.h ?? null;
  const low = priceData.low ?? priceData.l ?? null;
  const close = priceData.close ?? priceData.c ?? null;
  const volume = priceData.volume ?? priceData.v ?? null;

  await db.query(
    `INSERT INTO historical_prices (symbol, price_date, open, high, low, close, volume, data_source, updated_at, is_final,observed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, FALSE,$9)
     ON CONFLICT (symbol, price_date) DO UPDATE SET
       open = COALESCE($3, historical_prices.open),
       high = COALESCE($4, historical_prices.high),
       low = COALESCE($5, historical_prices.low),
       close = COALESCE($6, historical_prices.close),
       volume = COALESCE($7, historical_prices.volume),
       data_source = $8,
       observed_at=$9,
       updated_at = CURRENT_TIMESTAMP
     WHERE NOT historical_prices.is_final AND (historical_prices.observed_at IS NULL OR historical_prices.observed_at<=$9::timestamptz)`,
    [symbolUpper, today, open, high, low, close, volume, dataSource,asOf]
  );
}

module.exports = {
  getRange,
  hasRange,
  insertCandles,
  upsertToday
};
