// Finnhub's free tier only covers US listings, so every non-US holding arrives
// from /symbols/metadata with no logo at all — a German or LSE ticker would
// otherwise fall back to two grey initials. These CDNs need no API key and
// return a clean 404 for tickers they do not know, which the <img> error
// handler turns into the next candidate and finally back into initials.
//
// Parqet is tried first: it serves SVG (crisp at any size) and the real marks
// where FMP has only a wordmark.
const LOGO_CDNS = [
  (symbol) => `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}`,
  (symbol) => `https://images.financialmodelingprep.com/symbol/${encodeURIComponent(symbol)}.png`,
]

// Plain listed tickers only: option contract symbols and CUSIPs would never
// resolve, and asking for them just spends a request to get a 404.
const LISTED_SYMBOL = /^[A-Z0-9]{1,8}(?:[.-][A-Z0-9]{1,4})?$/

export function fallbackLogoUrls(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase()
  if (!normalized || !LISTED_SYMBOL.test(normalized)) return []
  return LOGO_CDNS.map((build) => build(normalized))
}
