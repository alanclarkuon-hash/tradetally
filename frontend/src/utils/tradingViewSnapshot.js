// Only public TradingView snapshot images are embedded; live chart pages stay external.
export function tradingViewSnapshot(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase()
    if (['tradingview.com', 'www.tradingview.com'].includes(host)) {
      const match = url.pathname.match(/^\/x\/([a-zA-Z0-9]{1,64})\/?$/)
      if (!match) return null
      const id = match[1]
      return {imageUrl: 'https://s3.tradingview.com/snapshots/' + id[0].toLowerCase() + '/' + id + '.png', sourceUrl: 'https://www.tradingview.com/x/' + id + '/'}
    }
    if (host === 's3.tradingview.com') {
      const match = url.pathname.match(/^\/snapshots\/([a-z0-9])\/([a-zA-Z0-9]{1,64})\.png$/)
      if (!match || match[1] !== match[2][0].toLowerCase()) return null
      return {imageUrl: url.origin + url.pathname, sourceUrl: 'https://www.tradingview.com/x/' + match[2] + '/'}
    }
  } catch { /* An incomplete input cannot be previewed. */ }
  return null
}