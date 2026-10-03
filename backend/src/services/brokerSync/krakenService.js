const axios = require('axios');
const { createHash, createHmac } = require('crypto');
const { isDeepStrictEqual } = require('util');
const db = require('../../config/database');

const ORIGIN = 'https://api.kraken.com';
const PRIVATE_PATHS = new Set(['/0/private/GetApiKeyInfo', '/0/private/BalanceEx',
  '/0/private/TradesHistory', '/0/private/Ledgers', '/0/private/OpenPositions', '/0/private/Earn/Allocations']);
const READ_PERMISSIONS = ['query-funds', 'query-open-trades', 'query-closed-trades', 'query-ledger'];
// Kraken charges history calls two counter units; the lowest tier replenishes
// only 0.33 units/sec. Leave headroom rather than assuming the account's tier.
function requestInterval(path) {
  return ['/0/private/TradesHistory', '/0/private/Ledgers'].includes(path) ? 7000 : 3500;
}

function signature(path, nonce, body, secret) {
  const hash = createHash('sha256').update(String(nonce) + body).digest();
  return createHmac('sha512', Buffer.from(secret, 'base64'))
    .update(Buffer.concat([Buffer.from(path), hash])).digest('base64');
}

function keyInfo(info) {
  if (!info || !Array.isArray(info.permissions) || !info.iban) {
    throw new Error('Kraken did not return complete API permissions and account identity.');
  }
  if (READ_PERMISSIONS.some(p => !info.permissions.includes(p)) ||
      info.permissions.some(p => !READ_PERMISSIONS.includes(p))) {
    throw new Error('Use only Query Funds, Query Open Orders & Trades, Query Closed Orders & Trades and Query Ledger Entries. Disable trading, withdrawals and Earn.');
  }
  if (Number(info.queryFrom || 0) !== 0 || Number(info.queryTo || 0) !== 0) {
    throw new Error('Remove the API key’s Query Start/End Date restrictions so the complete history can be reconciled.');
  }
  return { accountId: createHash('sha256').update(String(info.iban).trim()).digest('hex'), permissions: info.permissions };
}

function safeFailure(error) {
  const status = error.response?.status;
  const failure = new Error(status === 429 ? 'Kraken rate limit reached. Wait before retrying.' :
    `Unable to read Kraken data${status ? ` (HTTP ${status})` : ''}. Check the key, API secret and IP restrictions.`);
  failure.transient = status === 429 || status >= 500 || !error.response;
  failure.rateLimited = status === 429;
  return failure;
}

function result(body) {
  if (!Array.isArray(body?.error)) throw new Error('Kraken returned an invalid response.');
  if (body.error.length) {
    const codes = body.error.map(e => String(e).split(':').slice(0, 2).join(':'));
    let message = 'Kraken rejected the read request. Check API key permissions and restrictions.';
    if (codes.includes('EAPI:Invalid nonce')) message = 'Kraken rejected the request nonce. Use a dedicated key for TradeTally and check this PC’s clock before retrying.';
    else if (codes.includes('EAPI:Invalid key') || codes.includes('EAPI:Invalid signature')) message = 'Kraken rejected the API key or signing secret. Check both credentials.';
    else if (codes.includes('EAPI:Rate limit exceeded') || codes.includes('EService:Throttled')) message = 'Kraken rate limit reached. Wait before retrying.';
    const failure = new Error(message);
    failure.transient = codes.includes('EAPI:Rate limit exceeded') || codes.includes('EService:Throttled');
    failure.rateLimited = failure.transient;
    throw failure;
  }
  if (!body.result || typeof body.result !== 'object') throw new Error('Kraken returned an incomplete read response.');
  return body.result;
}

class KrakenService {
  constructor() { this.queue = Promise.resolve(); this.lastRequestAt = 0; }

  read(connection, path, params = {}) {
    const request = this.queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await this.privateRead(connection, path, params); }
        catch (error) {
          if (!error.rateLimited || attempt >= 2) throw error;
          // Retry only rate-limited reads after letting the entire call counter
          // drain. Preserve downloaded pages and sign with a fresh nonce.
          await new Promise(resolve => setTimeout(resolve, 60000));
        }
      }
    });
    this.queue = request.catch(() => {});
    return request;
  }

  async privateRead(connection, path, params) {
    if (!PRIVATE_PATHS.has(path)) throw new Error('Unsupported Kraken read endpoint.');
    if (!connection.krakenApiKey || !connection.krakenApiSecret ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(connection.krakenApiSecret)) {
      throw new Error('Kraken API key and base64 API secret are required.');
    }
    // Hold a per-key session lock through nonce reservation and HTTP completion,
    // ensuring that two app workers cannot send the same key out of order.
    const client = await db.connect();
    const fingerprint = createHash('sha256').update(connection.krakenApiKey).digest('hex');
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [fingerprint]);
      locked = true;
      const wait = Math.max(0, this.lastRequestAt + requestInterval(path) - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      const reserved = await client.query(`INSERT INTO kraken_api_nonces(key_hash,last_nonce) VALUES($1,$2)
        ON CONFLICT(key_hash) DO UPDATE SET last_nonce=GREATEST(kraken_api_nonces.last_nonce+1,EXCLUDED.last_nonce)
        RETURNING last_nonce`, [fingerprint, String(Date.now())]);
      const nonce = String(reserved.rows[0].last_nonce);
      const body = new URLSearchParams({ ...params, nonce }).toString();
      this.lastRequestAt = Date.now();
      let response;
      try {
        response = await axios.post(ORIGIN + path, body, { timeout: 30000, maxRedirects: 0,
          headers: { 'API-Key': connection.krakenApiKey, 'API-Sign': signature(path, nonce, body, connection.krakenApiSecret),
            'Content-Type': 'application/x-www-form-urlencoded' } });
      } catch (error) { throw safeFailure(error); }
      return result(response.data);
    } finally {
      // Destroy the connection if unlocking fails: a leaked session lock must
      // never return to the pool and stall subsequent syncs.
      let releaseError;
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [fingerprint]); }
        catch (error) { releaseError = error; }
      }
      client.release(releaseError);
    }
  }

  async validateCredentials(apiKey, apiSecret) {
    try {
      const info = keyInfo(await this.read({ krakenApiKey: apiKey, krakenApiSecret: apiSecret }, '/0/private/GetApiKeyInfo'));
      return { valid: true, ...info, message: 'Kraken read-only connection validated' };
    } catch (error) { return { valid: false, message: error.message }; }
  }

  async history(connection, path, field, end) {
    const entries = new Map();
    let expectedCount;
    for (let page = 0, offset = 0; page < 10000; page++) {
      // A fixed end prevents new activity shifting offset pages during a sync.
      const data = await this.read(connection, path, { type: 'all', start: '0', end: String(end), ofs: String(offset),
        ...(field === 'trades' ? { consolidate_taker: 'false', ledgers: 'true', limit: '50' } : {}) });
      if (!data[field] || typeof data[field] !== 'object' || Array.isArray(data[field]) ||
          !Number.isSafeInteger(Number(data.count)) || Number(data.count) < 0 || data.count === null) {
        throw new Error('Kraken returned incomplete history pagination.');
      }
      if (expectedCount === undefined) expectedCount = Number(data.count);
      if (Number(data.count) !== expectedCount) throw new Error('Kraken history changed during download. Retry the sync.');
      const rows = Object.entries(data[field]);
      for (const [id, row] of rows) {
        if (!row || !Number.isFinite(Number(row.time))) throw new Error('Kraken returned an invalid history row.');
        if (entries.has(id)) {
          if (!isDeepStrictEqual(entries.get(id), row)) throw new Error('Kraken returned conflicting history identities.');
          throw new Error('Kraken history pagination repeated a row. Retry the sync.');
        }
        entries.set(id, row);
      }
      offset += rows.length;
      if (offset === expectedCount) return Object.fromEntries(entries);
      if (rows.length === 0 || offset > expectedCount) throw new Error('Kraken history ended before all rows were retrieved.');
    }
    throw new Error('Kraken history exceeded the maximum supported pages.');
  }

  async syncTrades(connection) {
    const info = keyInfo(await this.read(connection, '/0/private/GetApiKeyInfo'));
    if (info.accountId !== connection.externalAccountId) throw new Error('Kraken account identity changed. Reconnect the correct account.');
    const asOf = new Date().toISOString();
    const end = Math.floor(Date.parse(asOf) / 1000);
    const balances = await this.read(connection, '/0/private/BalanceEx');
    const allocations = await this.read(connection, '/0/private/Earn/Allocations', { converted_asset: 'USD', hide_zero_allocations: 'false' });
    if (!Array.isArray(allocations.items)) throw new Error('Kraken returned incomplete staking allocations.');
    // The documented method has no request cursor. Preserve any returned
    // marker for review; never claim it is a complete reconciled portfolio.
    const allocationMayBeTruncated = Boolean(allocations.next_cursor);
    const positions = await this.read(connection, '/0/private/OpenPositions');
    const trades = await this.history(connection, '/0/private/TradesHistory', 'trades', end);
    const ledger = await this.history(connection, '/0/private/Ledgers', 'ledger', end);
    for (const value of Object.values(balances)) {
      if (!value || !Number.isFinite(Number(value.balance))) throw new Error('Kraken returned an invalid asset balance.');
    }
    const payload = {balances,allocations,positions,trades,ledger,asOf,historyEnd:end,
      historyDownloaded:true,allocationMayBeTruncated,reconciled:false};
    if (!connection.brokerMetadata?.import_pending_review) {
      const previous = (await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='kraken' AND account_identifier=$2",
        [connection.userId,`Kraken ****${info.accountId.slice(-4)}`])).rows[0]?.payload;
      payload.valuation = await require('./krakenValuation').collect({...payload,valuation:previous?.valuation});
      return require('./krakenImport').reconcile(connection,payload);
    }
    // Preserve native balances, fee currencies and staking ledger identities.
    // Balances and staking allocations are overlapping views, not additive.
    await db.query(`INSERT INTO broker_import_snapshots(user_id,broker_type,account_identifier,connection_id,payload,captured_at)
      VALUES($1,'kraken',$2,$3,$4::jsonb,NOW()) ON CONFLICT(user_id,broker_type,account_identifier)
      DO UPDATE SET connection_id=EXCLUDED.connection_id,payload=EXCLUDED.payload,captured_at=NOW()`,
    [connection.userId, `Kraken ****${info.accountId.slice(-4)}`, connection.id,
      JSON.stringify(payload)]);
    return { imported: 0, skipped: 0, failed: 0, duplicates: 0, outcome: 'warning',
      tradeRows: Object.keys(trades).length, openPositionRows: Object.keys(balances).length,
      warnings: ['Kraken spot trades, balances, staking allocations and the complete available ledger were downloaded privately. Holdings, staking rewards, fees and transfers await reconciliation before entering reports.',
        ...(allocationMayBeTruncated ? ['Kraken returned a staking allocation cursor; allocation coverage must be checked against balances before reporting.'] : [])] };
  }
}

module.exports = new KrakenService();
module.exports.signature = signature;
module.exports.keyInfo = keyInfo;
module.exports.requestInterval = requestInterval;
