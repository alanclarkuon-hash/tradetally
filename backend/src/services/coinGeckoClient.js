const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const { CRYPTO_TO_COINGECKO } = require('../utils/cryptoAssets');
const DAY = 86400000;

// One instance per application. Budget survives container restarts in the data volume.
// Defaults reserve half the free allowance for the other local environment.
function createClient({ transport = axios, storage = fs, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  file = path.join(__dirname, '../data/coingecko-budget.json'),
  spacing = 10000, allowance = 4000 } = {}) {
  let state, tail = Promise.resolve();
  const inFlight = new Map(), responses = new Map();
  async function load() {
    if (state) return;
    try {
      const saved = JSON.parse(await storage.readFile(file, 'utf8'));
      if (!Array.isArray(saved.calls) || saved.calls.some(t => !Number.isFinite(t)) ||
          !Number.isFinite(saved.cooldownUntil) || !Number.isFinite(saved.failures)) throw new Error('Invalid budget');
      state = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('CoinGecko budget unavailable; requests paused');
      state = { calls: [], cooldownUntil: 0, failures: 0 };
    }
  }
  async function save() {
    await storage.mkdir(path.dirname(file), { recursive: true });
    await storage.writeFile(file + '.tmp', JSON.stringify(state));
    await storage.rename(file + '.tmp', file);
  }
  function paused(message) { const error = new Error(message); error.code = 'COINGECKO_PAUSED'; return error; }
  function get(endpoint, { params = {}, ttl = 0 } = {}) {
    if (!/^\/(coins(?:\/[a-z0-9-]+)*(?:\/market_chart)?|simple\/price)$/.test(endpoint)) return Promise.reject(new Error('Invalid CoinGecko endpoint'));
    const key = endpoint + JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
    const cached = responses.get(key);
    if (cached && now() - cached.at < ttl) return Promise.resolve(cached.response);
    if (inFlight.has(key)) return inFlight.get(key);
    const job = tail.then(async () => {
      await load();
      if (now() < state.cooldownUntil) throw paused('CoinGecko cooldown active');
      state.calls = state.calls.filter(t => t > now() - 31 * DAY);
      if (state.calls.length >= allowance) throw paused('CoinGecko rolling monthly budget reached');
      const last = state.calls.at(-1);
      if (last !== undefined && now() - last < spacing) await sleep(spacing - (now() - last));
      // Reserve every attempted call before sending, including failed HTTP requests.
      state.calls.push(now());
      await save(); // Fail closed if the persistent budget cannot be written.
      try {
        const headers = { Accept: 'application/json' };
        if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
        const response = await transport.get('https://api.coingecko.com/api/v3' + endpoint, { params, headers, timeout: 15000 });
        state.failures = 0;
        responses.set(key, { at: now(), response });
        if (responses.size > 256) responses.delete(responses.keys().next().value);
        await save();
        return response;
      } catch (error) {
        state.failures += 1;
        const retry = error.response?.headers?.['retry-after'];
        const retryDelay = /^\d+(\.\d+)?$/.test(String(retry)) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - now()) || 0;
        state.cooldownUntil = now() + Math.max(retryDelay, error.response?.status === 429
          ? Math.min(DAY, 15 * 60000 * 2 ** Math.min(state.failures - 1, 7)) : 60000);
        await save();
        throw paused(`CoinGecko request failed (${error.response?.status || 'network error'}); requests paused`);
      }
    });
    tail = job.catch(() => {});
    inFlight.set(key, job);
    job.finally(() => inFlight.delete(key)).catch(() => {});
    return job;
  }
  return { get };
}

const client = createClient();
const quoteIds = new Set(Object.values(CRYPTO_TO_COINGECKO));
async function getPrices(id) {
  quoteIds.add(id);
  // A single cached batch serves price-monitoring and enrichment callers.
  return client.get('/simple/price', { params: { ids: [...quoteIds].sort().join(','), vs_currencies: 'usd',
    include_24hr_change: true, include_24hr_vol: true, include_last_updated_at: true }, ttl: 15 * 60000 });
}
module.exports = { get: client.get, getPrices, createClient };
