function priceCacheKey(symbol, instrumentType) {
  const ticker = String(symbol).trim().toUpperCase();
  return instrumentType === 'crypto' ? `crypto:${ticker}` : ticker;
}

function usablePriceRow(row, instrumentType) {
  if (!row) return false;
  const cryptoSource = row.data_source === 'coingecko' || /^broker:[^:]+:crypto$/.test(row.data_source || '');
  return instrumentType === 'crypto' ? cryptoSource : !cryptoSource;
}

// Watchlists/alerts predate instrument types and retain their existing supported
// crypto ticker convention. Holdings/trades always supply an explicit type.
function autoPriceKeySql(alias) {
  const {CRYPTO_SYMBOLS} = require('./cryptoAssets');
  const symbols = CRYPTO_SYMBOLS.map(symbol=>`'${symbol}'`).join(',');
  return `CASE WHEN ${alias}.symbol IN (${symbols}) THEN 'crypto:' || ${alias}.symbol ELSE ${alias}.symbol END`;
}

module.exports = { priceCacheKey, usablePriceRow, autoPriceKeySql };
