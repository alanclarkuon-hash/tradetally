const cryptoCategories = require('../services/cryptoCategoriesService');
const { applyCategoryOverride } = require('../services/categoryOverrides');

// Equity and crypto tickers are separate identities, even when text matches.
// Analytics reads cached metadata only; viewing a report must not call providers.
async function getSectorCategory(trade, companyCategory) {
  if (trade.instrument_type !== 'crypto') return companyCategory;
  const metadata = applyCategoryOverride(trade.symbol, 'crypto',
    await cryptoCategories.getCachedCategories(trade.symbol));
  return { finnhub_industry: metadata?.primaryCategory
    ? `Crypto · ${metadata.primaryCategory}` : 'Crypto · Unclassified' };
}

async function applyTradeSectorCategories(trades) {
  const categories = new Map();
  for (const trade of trades) {
    if (trade.instrument_type !== 'crypto') continue;
    if (!categories.has(trade.symbol)) categories.set(trade.symbol,
      (await getSectorCategory(trade, null)).finnhub_industry);
    trade.sector = categories.get(trade.symbol);
    trade.company_name = null;
  }
  return trades;
}

async function buildSectorPredicate(userId, sectors, values) {
  const clauses = [];
  const companySectors = sectors.filter(s => !s.startsWith('Crypto · '));
  if (companySectors.length) {
    const placeholders = companySectors.map(s => {values.push(s);return `$${values.length}`;});
    clauses.push(`(t.instrument_type IS DISTINCT FROM 'crypto' AND EXISTS (SELECT 1 FROM symbol_categories sc WHERE sc.symbol = t.symbol AND sc.finnhub_industry IN (${placeholders.join(',')})))`);
  }
  if (sectors.some(s => s.startsWith('Crypto · '))) {
    const db = require('../config/database');
    const rows = (await db.query("SELECT DISTINCT symbol, instrument_type FROM trades WHERE user_id=$1 AND instrument_type='crypto'", [userId])).rows;
    const matches = [];
    for (const row of rows) if (sectors.includes((await getSectorCategory(row, null)).finnhub_industry)) matches.push(row.symbol);
    values.push(matches);
    clauses.push(`(t.instrument_type = 'crypto' AND t.symbol = ANY($${values.length}::text[]))`);
  }
  return clauses.length ? `(${clauses.join(' OR ')})` : 'FALSE';
}

module.exports = { getSectorCategory, applyTradeSectorCategories, buildSectorPredicate };
