// A quote's session describes when its price was observed, not when we fetched it.
const sessions = new Set(['regular', 'pre', 'post', 'overnight', 'continuous']);
function normalizeSession(value) { return sessions.has(value) ? value : null; }

function yahooQuote(result) {
  const meta = result?.meta || {};
  const finite = value => value != null && value !== '' && Number.isFinite(Number(value));
  let selected = { c: Number(meta.regularMarketPrice), t: Number(meta.regularMarketTime), session: 'regular' };
  if (!finite(meta.regularMarketPrice) || !(selected.c > 0)) return null;
  if (!finite(meta.regularMarketTime) || !(selected.t > 0)) selected.session = null;
  // Chart responses supply dated exchange session boundaries. Never classify
  // yesterday's candle using today's opening hours or the fetch timestamp.
  const periods = meta.currentTradingPeriod || {};
  const times = result.timestamp || [], closes = result.indicators?.quote?.[0]?.close || [];
  for (let i = 0; i < times.length; i++) {
    const t = Number(times[i]), c = Number(closes[i]);
    if (!finite(closes[i]) || !(c > 0) || !(t > selected.t) || t > Date.now()/1000+60) continue;
    const session = ['pre', 'regular', 'post'].find(key =>
      Number.isFinite(Number(periods[key]?.start)) && Number.isFinite(Number(periods[key]?.end)) &&
      t >= Number(periods[key].start) && t < Number(periods[key].end));
    // Keep regularMarketPrice for the regular session. Intraday closes are
    // used only when a later, explicitly bounded extended session is present.
    if (session === 'pre' || session === 'post') selected = { c, t, session };
  }
  return selected;
}
module.exports = { normalizeSession, yahooQuote };
