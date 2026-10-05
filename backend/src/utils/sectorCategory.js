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

module.exports = { getSectorCategory };
