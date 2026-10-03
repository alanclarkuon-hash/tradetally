// Bare crypto tickers can also name stocks (SUI, for example). Equity quote
// caches/providers cannot establish which asset a crypto position represents.
function usesEquityQuotes(position) {
  return !['option', 'crypto', 'spread_bet'].includes(position.instrumentType);
}

function selectPositionQuote(position, convertedQuote, symbolQuote) {
  if (['crypto','spread_bet'].includes(position.instrumentType)) return position.brokerQuote || null;
  return convertedQuote || symbolQuote || position.brokerQuote || null;
}

module.exports = { usesEquityQuotes, selectPositionQuote };
