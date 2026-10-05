const fs = require('fs/promises');
const path = require('path');
const client = require('./coinGeckoClient');
const { CRYPTO_TO_COINGECKO } = require('../utils/cryptoAssets');
const file = path.join(__dirname, '../data/coingecko-directory.json');
let directory, loading, refresh;
async function load() {
  if (!loading) loading = (async () => {
    try { directory = JSON.parse(await fs.readFile(file, 'utf8')); } catch { directory = { coins: [], asOf: 0 }; }
    if (!Array.isArray(directory.coins) || !Number.isFinite(directory.asOf)) directory = { coins: [], asOf: 0 };
  })();
  await loading;
}
function match(symbol) {
  const candidates = directory.coins.filter(c => String(c.symbol).toUpperCase() === symbol);
  return candidates.length === 1 ? candidates[0] : null;
}
async function resolve(symbol) {
  symbol = String(symbol).trim().toUpperCase();
  if (CRYPTO_TO_COINGECKO[symbol]) return { id: CRYPTO_TO_COINGECKO[symbol] };
  await load();
  if (Date.now() - directory.asOf >= 7 * 86400000) {
    if (!refresh) refresh = (async () => {
      const response = await client.get('/coins/list', { ttl: 7 * 86400000 });
      if (!Array.isArray(response.data) || !response.data.every(c => typeof c.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(c.id) && typeof c.symbol === 'string' && typeof c.name === 'string')) throw new Error('Invalid CoinGecko directory');
      directory = { asOf: Date.now(), coins: response.data };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + '.tmp', JSON.stringify(directory));
      await fs.rename(file + '.tmp', file);
    })().finally(() => { refresh = null; });
    try { await refresh; } catch { /* Keep the last directory during provider cooldowns. */ }
  }
  // Never guess among duplicate tickers. A verified explicit mapping is required.
  return match(symbol);
}
async function cached(symbol) {
  symbol = String(symbol).trim().toUpperCase();
  if (CRYPTO_TO_COINGECKO[symbol]) return { id: CRYPTO_TO_COINGECKO[symbol] };
  await load();
  return match(symbol);
}
module.exports = { resolve, cached };
