const axios = require('axios');

// Shared public market-data lanes: Kraken permits <=1 request/second. OKX
// ticker limits are 20/2s, history 20/2s. 2.5s spacing leaves ample headroom.
// Public IP budgets are separate from private authenticated account budgets.
const lanes = new Map(), directories = new Map();
async function read(broker, url, params, { background = false } = {}) {
  let lane = lanes.get(broker);
  if (!lane) lanes.set(broker, lane = { queue: Promise.resolve(), pending: 0, until: 0 });
  if (background && (lane.pending || Date.now() < lane.until)) return null;
  lane.pending++;
  const work = lane.queue.catch(() => {}).then(async () => {
    if (Date.now() < lane.until) throw Error('Broker market data cooling down');
    await new Promise(resolve => setTimeout(resolve, 2500));
    try {
      const response = await axios.get(url, { params, timeout: 15000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024 });
      if (response.data?.code === '50011' || response.data?.error?.some(e => /Rate limit|Throttled/i.test(e))) {
        lane.until = Date.now() + 60000;
        throw Error('Broker market data cooling down');
      }
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        const retry = error.response.headers?.['retry-after'];
        const delay = Number(retry) * 1000 || Date.parse(retry) - Date.now() || 60000;
        lane.until = Date.now() + Math.max(60000, delay);
      }
      throw Error('Broker market data unavailable'); // Never propagate HTTP request headers.
    }
  }).finally(() => { lane.pending--; });
  lane.queue = work.catch(() => {});
  return work;
}
async function directory(key, fetch) {
  const old = directories.get(key);
  if (old && Date.now() < old.expires) return old.value;
  const value = await fetch();
  if (value) directories.set(key, { value, expires: Date.now() + 86400000 });
  return value;
}
module.exports = { read, directory };
