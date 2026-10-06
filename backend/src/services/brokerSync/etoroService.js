const axios = require('axios');
const { randomUUID } = require('crypto');
const db = require('../../config/database');
const BrokerConnection = require('../../models/BrokerConnection');

const ORIGIN = 'https://public-api.etoro.com/api/v1';
const PAGE_SIZE = 100;
const HISTORY_WARNING = 'eToro API history covers less than one year. Older trades, including past CopyTrader and Smart Portfolio trades, need an account statement.';
const REVIEW_WARNING = 'eToro data downloaded for review. Trades and holdings have not yet been added to your reports.';

// Documentation uses both ID and Id spellings in schema and examples.
function field(object, name) {
  const key = Object.keys(object || {}).find(k => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : object[key];
}

function flattenPositions(portfolio) {
  const positions = field(portfolio, 'positions');
  const mirrors = field(portfolio, 'mirrors');
  if (!Array.isArray(positions) || (mirrors != null && !Array.isArray(mirrors))) {
    throw new Error('eToro returned an incomplete portfolio. No data was saved.');
  }
  const byId = new Map();
  for (const position of [...positions, ...(mirrors || []).flatMap(m => {
    const nested = field(m, 'positions');
    if (!Array.isArray(nested)) throw new Error('eToro returned an incomplete copied portfolio. No data was saved.');
    return nested;
  })]) {
    const id = field(position, 'positionId');
    if (id == null || field(position, 'instrumentId') == null ||
        !(Number(field(position, 'units')) > 0)) {
      throw new Error('eToro returned an incomplete position. No data was saved.');
    }
    const old = byId.get(String(id));
    if (old && (Number(field(old, 'units')) !== Number(field(position, 'units')) ||
        String(field(old, 'instrumentId')) !== String(field(position, 'instrumentId')))) {
      throw new Error('eToro returned conflicting copied positions. No data was saved.');
    }
    byId.set(String(id), position);
  }
  return [...byId.values()];
}

function historyStart(requested, now = new Date()) {
  const floor = new Date(now);
  floor.setUTCDate(floor.getUTCDate() - 364);
  const earliest = floor.toISOString().slice(0, 10);
  if (!requested) return earliest;
  const parsed = new Date(requested);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid eToro history start date.');
  const date = parsed.toISOString().slice(0, 10);
  if (date > now.toISOString().slice(0, 10)) throw new Error('eToro history start date cannot be in the future.');
  return date < earliest ? earliest : date;
}

class EtoroService {
  constructor() { this.lastRequestAt = 0; this.requestQueue = Promise.resolve(); this.cooldownUntil = 0; this.pendingRequests = 0; }

  async get(connection, path, params, { background = false } = {}) {
    if (background && (this.pendingRequests || Date.now() < this.cooldownUntil)) return null;
    this.pendingRequests++;
    const pending = this.requestQueue.then(() => this.read(connection, path, params)).finally(() => { this.pendingRequests--; });
    this.requestQueue = pending.catch(() => {});
    return pending;
  }

  async read(connection, path, params) {
    if (Date.now() < this.cooldownUntil) throw new Error('eToro rate limit cooling down. Please wait before trying again.');
    if (!connection.etoroApiKey || !connection.etoroUserKey) throw new Error('Both eToro keys are required.');
    // Only fixed GET paths are exposed. Never follow a redirect with secret headers.
    if (!/^\/(me|trading\/info\/real\/pnl|trading\/info\/trade\/history|market-data\/(instruments(?:\/rates)?|instrument-types|search))$/.test(path)) {
      throw new Error('Unsupported eToro read endpoint.');
    }
    const wait = Math.max(0, this.lastRequestAt + 1100 - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
    try {
      const response = await axios.get(`${ORIGIN}${path}`, {
        headers: { 'x-api-key': connection.etoroApiKey, 'x-user-key': connection.etoroUserKey,
          'x-request-id': randomUUID() },
        params, timeout: 30000, maxRedirects: 0
      });
      if (Number(response.headers?.['ratelimit-remaining']) === 0) {
        this.cooldownUntil = Date.now() + Math.max(1, Number(response.headers?.['ratelimit-reset']) || 60) * 1000;
      }
      return response.data;
    } catch (error) {
      // Axios errors contain request headers. Never propagate or log them.
      const status = error.response?.status;
      if (status === 401 || status === 403) throw new Error('eToro rejected the keys or permissions. Use real-account Read All keys.');
      if (status === 429) {
        const retry = error.response?.headers?.['retry-after'];
        const delay = Number(retry) * 1000 || Date.parse(retry) - Date.now() || 60000;
        this.cooldownUntil = Date.now() + Math.max(60000, delay);
        throw new Error('eToro rate limit reached. Please wait before trying again.');
      }
      throw new Error(`Unable to read eToro data${status ? ` (HTTP ${status})` : ''}. Please try again later.`);
    }
  }

  async validateCredentials(apiKey, userKey) {
    try {
      const connection = { etoroApiKey: apiKey, etoroUserKey: userKey };
      const identity = await this.get(connection, '/me');
      const accountId = field(identity, 'realCid');
      if (accountId == null || !/^[1-9]\d*$/.test(String(accountId))) throw new Error('eToro did not identify a real trading account.');
      const response = await this.get(connection, '/trading/info/real/pnl');
      flattenPositions(field(response, 'clientPortfolio'));
      return { valid: true, accountId: String(accountId), currency: 'USD', message: 'eToro read connection is valid' };
    } catch (error) {
      return { valid: false, message: error.message };
    }
  }

  async fetchHistory(connection, startDate) {
    const all = [];
    const seen = new Set();
    for (let page = 1; page <= 1000; page++) {
      const rows = await this.get(connection, '/trading/info/trade/history',
        { minDate: historyStart(startDate), page, pageSize: PAGE_SIZE });
      if (!Array.isArray(rows)) throw new Error('eToro returned invalid trade history. No data was saved.');
      for (const row of rows) {
        if (field(row, 'positionId') == null || !field(row, 'closeTimestamp') ||
            field(row, 'instrumentId') == null) throw new Error('eToro returned incomplete trade history. No data was saved.');
        // Partial closes share a position ID; retain every distinct closing slice.
        const key = JSON.stringify([field(row, 'positionId'), field(row, 'orderId'),
          field(row, 'closeTimestamp'), field(row, 'units')]);
        if (seen.has(key)) throw new Error('eToro history pages overlap. No data was saved; retry later.');
        seen.add(key);
        all.push(row);
      }
      if (rows.length < PAGE_SIZE) return all;
    }
    throw new Error('eToro history exceeded the page limit. No data was saved.');
  }

  async syncTrades(connection, { startDate, syncLogId } = {}) {
    if (connection.brokerEnvironment !== 'real') throw new Error('This eToro connection supports real accounts only.');
    if (syncLogId) await BrokerConnection.updateSyncLog(syncLogId, 'fetching');
    const identity = await this.get(connection, '/me');
    if (String(field(identity, 'realCid')) !== String(connection.externalAccountId)) {
      throw new Error('eToro account identity changed. Reconnect before syncing.');
    }
    const portfolioResponse = await this.get(connection, '/trading/info/real/pnl');
    const portfolio = field(portfolioResponse, 'clientPortfolio');
    const positions = flattenPositions(portfolio);
    const history = await this.fetchHistory(connection, startDate);
    const ids = [...new Set([...positions, ...history].map(p => String(field(p, 'instrumentId'))))];
    const instruments = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const data = await this.get(connection, '/market-data/instruments', { instrumentIds: ids.slice(offset, offset + 50).join(',') });
      const rows = field(data, 'instrumentDisplayDatas');
      if (!Array.isArray(rows)) throw new Error('eToro returned invalid instrument details. No data was saved.');
      instruments.push(...rows);
    }
    const typesResponse = await this.get(connection, '/market-data/instrument-types');
    const instrumentTypes = field(typesResponse, 'instrumentTypes');
    if (!Array.isArray(instrumentTypes)) throw new Error('eToro returned invalid instrument types. No data was saved.');
    if (ids.some(id => !instruments.some(i => String(field(i, 'instrumentId')) === id))) {
      throw new Error('eToro instrument details are incomplete. No data was saved.');
    }
    // Staging is deliberately separate from report holdings and cashflow tables.
    // Keep the full private portfolio/history for currency and copied-trade review.
    const payload = { version: 1, currency: 'USD', historyStart: historyStart(startDate),
      portfolio, positions, history, instruments, instrumentTypes };
    await db.query(`INSERT INTO broker_import_snapshots(user_id,broker_type,account_identifier,connection_id,payload)
      VALUES($1,'etoro',$2,$3,$4::jsonb)
      ON CONFLICT(user_id,broker_type,account_identifier) DO UPDATE
      SET connection_id=EXCLUDED.connection_id,payload=EXCLUDED.payload,captured_at=NOW()`,
    [connection.userId, `etoro:${connection.externalAccountId}`, connection.id, JSON.stringify(payload)]);
    if (connection.brokerMetadata?.import_pending_review === false) {
      const result = await require('./etoroReconcile').reconcile(connection, payload);
      return { ...result, warnings: [HISTORY_WARNING], outcome: 'warning' };
    }
    return { imported: 0, skipped: 0, duplicates: 0, failed: 0,
      tradeRows: history.length, openPositionRows: positions.length,
      warnings: [REVIEW_WARNING, HISTORY_WARNING], outcome: 'warning' };
  }
}

module.exports = new EtoroService();
module.exports.EtoroService = EtoroService;
module.exports.flattenPositions = flattenPositions;
module.exports.historyStart = historyStart;
