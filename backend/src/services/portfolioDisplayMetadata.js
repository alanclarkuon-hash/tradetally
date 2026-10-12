const db = require('../config/database');
const yahoo = require('../utils/yahooFinance');
const funds = require('./fundCategoriesService');
const DAY = 86400000;
const pending = new Map();
const retryAfter = new Map();
let active = 0;
const queue = [];

function drain() {
  while (active < 4 && queue.length) {
    const job = queue.shift(); active++;
    job().finally(() => { active--; drain(); });
  }
}
function refresh(symbol, saved) {
  if (pending.has(symbol) || Date.now() < (retryAfter.get(symbol) || 0)) return;
  let finish;
  pending.set(symbol, new Promise(resolve => { finish = resolve; }));
  queue.push(async () => {
    try {
      const profile = await yahoo.getSymbolProfile(symbol);
      if (!profile || profile.symbol !== symbol) return;
      let labels = null;
      if (['ETF','MUTUALFUND'].includes(profile.quoteType)) {
        labels = await funds.getCategories(symbol);
        if (!labels?.categories?.length && saved?.fund_categories?.categories?.length) labels = saved.fund_categories;
      }
      await db.query(`INSERT INTO portfolio_display_metadata (symbol,profile,fund_categories,fetched_at)
        VALUES ($1,$2,$3,NOW()) ON CONFLICT(symbol) DO UPDATE SET
        profile=EXCLUDED.profile,fund_categories=EXCLUDED.fund_categories,fetched_at=NOW()`,[symbol,profile,labels]);
    } catch { /* Keep saved public metadata during a provider outage. */ }
    finally {
      retryAfter.set(symbol, Date.now() + 60000);
      pending.delete(symbol); finish();
    }
  });
  drain();
}
async function getDisplayMetadata(symbols) {
  const wanted = [...new Set(symbols.map(s => String(s).trim().toUpperCase()).filter(s => /^[A-Z0-9.^=_/-]{1,64}$/.test(s)))];
  if (!wanted.length) return { records: new Map(), updating: false };
  const rows = (await db.query('SELECT symbol,profile,fund_categories,fetched_at FROM portfolio_display_metadata WHERE symbol=ANY($1)',[wanted])).rows;
  const records = new Map(rows.map(row => [row.symbol,row]));
  for (const symbol of wanted) {
    const saved = records.get(symbol);
    if (!saved || Date.now() - Date.parse(saved.fetched_at) > DAY) refresh(symbol,saved);
  }
  return { records, updating: wanted.some(s => pending.has(s)) };
}
module.exports = { getDisplayMetadata };
