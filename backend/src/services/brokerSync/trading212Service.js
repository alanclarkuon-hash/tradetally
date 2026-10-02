const axios = require('axios');
const OAuthBrokerBase = require('./oauthBrokerBase');
const BrokerConnection = require('../../models/BrokerConnection');
const { normaliseMinorUnit } = require('../../utils/quoteCurrency');

const PAGE_SIZE = 50;
const MAX_PAGES = 1000;
const MAX_RATE_LIMIT_WAIT_MS = 65 * 1000;

function getApiBase(environment = 'live') {
  return environment === 'demo'
    ? 'https://demo.trading212.com/api/v0'
    : 'https://live.trading212.com/api/v0';
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeTicker(ticker) {
  const raw = String(ticker || '').trim();
  // Trading 212 uses a lowercase exchange suffix, e.g. VODl_EQ. Preserve
  // London listing identity; SPXL.L is a different fund from US-listed SPXL.
  const london = raw.match(/^(.+)l_EQ$/) || raw.match(/^(.+)_GB_EQ$/i);
  if (london) return `${london[1].toUpperCase()}.L`;
  return raw.replace(/_US_EQ$/i, '').toUpperCase();
}

function numericTaxAmount(tax) {
  if (!tax || typeof tax !== 'object') return 0;
  const value = tax.amount ?? tax.value ?? tax.cost ?? tax.charge ?? tax.quantity;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

class Trading212Service extends OAuthBrokerBase {
  constructor() {
    super({
      brokerType: 'trading212',
      displayName: 'Trading 212',
      logPrefix: 'TRADING212'
    });
  }

  async validateCredentials(apiKey, apiSecret, environment = 'live') {
    if (!apiKey || !apiSecret) {
      return { valid: false, message: 'Trading 212 API key and secret are required' };
    }

    try {
      const response = await axios.get(`${getApiBase(environment)}/equity/account/summary`, {
        auth: { username: apiKey, password: apiSecret },
        timeout: 15000
      });
      const summary = response.data || {};
      return {
        valid: true,
        message: 'Trading 212 connection is valid',
        accountId: summary.id != null ? String(summary.id) : null,
        currency: summary.currency || null
      };
    } catch (error) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        return { valid: false, message: 'Trading 212 rejected the API key or secret' };
      }
      if (status === 429) {
        return { valid: false, message: 'Trading 212 rate limit reached. Please wait and try again.' };
      }
      return {
        valid: false,
        message: `Unable to validate Trading 212 credentials: ${error.message}`
      };
    }
  }

  async syncTrades(connection, options = {}) {
    const { startDate, endDate, syncLogId } = options;
    if (!connection.trading212ApiKey || !connection.trading212ApiSecret) {
      throw new Error('Trading 212 credentials are missing. Reconnect the broker account.');
    }

    if (syncLogId) await BrokerConnection.updateSyncLog(syncLogId, 'fetching');
    const rawExecutions = await this.fetchExecutions(connection, { startDate, endDate });
    if (syncLogId) {
      await BrokerConnection.updateSyncLog(syncLogId, 'parsing', { tradesFetched: rawExecutions.length });
    }

    const trades = this.mapExecutionsToTrades(rawExecutions, connection);
    if (syncLogId) await BrokerConnection.updateSyncLog(syncLogId, 'importing');
    // Reconcile complete execution identities rather than treating any shared
    // fill as a duplicate. A sell can legitimately close several entry lots.
    const positions = await this.fetchPositions(connection);
    const result = await require('./trading212Reconcile').reconcileSnapshot(connection, rawExecutions, trades);
    await require('./portfolioSnapshot').saveTrading212Snapshot(connection, positions);
    const cashSections = {};
    for (const section of ['transactions','dividends']) {
      cashSections[section] = await this.fetchCashHistory(connection,section);
    }
    const cash = await require('./trading212CashEvents').importCashEvents(connection,cashSections);
    result.cashEventsImported = cash.imported;
    const summary = await this.requestPage(`${getApiBase(connection.brokerEnvironment || 'live')}/equity/account/summary`,
      {username:connection.trading212ApiKey,password:connection.trading212ApiSecret});
    await require('./trading212CashLedger').saveCashReport(connection,rawExecutions,summary.data);
    return result;
  }

  async fetchCashHistory(connection, section) {
    if (!['transactions','dividends'].includes(section)) throw new Error('Unsupported cash history section');
    const base = getApiBase(connection.brokerEnvironment || 'live');
    const path = `/api/v0/equity/history/${section}`;
    const auth = {username:connection.trading212ApiKey,password:connection.trading212ApiSecret};
    const items = [], seen = new Set();
    let url = `${base}/equity/history/${section}?limit=${PAGE_SIZE}`;
    while (url) {
      if (seen.has(url) || seen.size >= MAX_PAGES) throw new Error('Invalid Trading 212 cash pagination');
      seen.add(url);
      const response = await this.requestPage(url,auth);
      if (!Array.isArray(response.data?.items)) throw new Error('Invalid Trading 212 cash history response');
      items.push(...response.data.items);
      const next = response.data.nextPagePath;
      if (!next) break;
      const nextUrl = new URL(next,`${base}/`);
      if (nextUrl.origin !== new URL(base).origin || nextUrl.pathname !== path) throw new Error('Invalid Trading 212 cash pagination URL');
      url = nextUrl.toString();
      if (Number(response.headers?.['x-ratelimit-remaining']) <= 0) await this.waitForRateLimitReset(response.headers);
    }
    return items;
  }

  async fetchPositions(connection) {
    const response = await axios.get(`${getApiBase(connection.brokerEnvironment || 'live')}/equity/positions`, {
      auth: { username: connection.trading212ApiKey, password: connection.trading212ApiSecret }, timeout: 15000
    });
    if (!Array.isArray(response.data)) throw new Error('Invalid Trading 212 positions response');
    return response.data;
  }

  async fetchExecutions(connection, { startDate, endDate } = {}) {
    const baseUrl = getApiBase(connection.brokerEnvironment || 'live');
    const baseOrigin = new URL(baseUrl).origin;
    const auth = {
      username: connection.trading212ApiKey,
      password: connection.trading212ApiSecret
    };
    const executions = [];
    const seenPaths = new Set();
    let requestUrl = `${baseUrl}/equity/history/orders?limit=${PAGE_SIZE}`;

    for (let page = 0; requestUrl && page < MAX_PAGES; page++) {
      if (seenPaths.has(requestUrl)) {
        throw new Error('Trading 212 returned a repeated pagination cursor');
      }
      seenPaths.add(requestUrl);

      const response = await this.requestPage(requestUrl, auth);
      const items = Array.isArray(response.data?.items) ? response.data.items : [];

      for (const item of items) {
        const filledAt = item?.fill?.filledAt;
        const fillDate = toDateOnly(filledAt);
        if (!fillDate) continue;
        if (startDate && fillDate < String(startDate).slice(0, 10)) continue;
        if (endDate && fillDate > String(endDate).slice(0, 10)) continue;
        const accountId = connection.externalAccountId;
        executions.push({
          ...item,
          _accountIdentifier: accountId ? `****${String(accountId).slice(-4)}` : null
        });
      }

      const nextPagePath = response.data?.nextPagePath;
      if (!nextPagePath) {
        requestUrl = null;
        break;
      }

      const nextUrl = new URL(nextPagePath, `${baseUrl}/`);
      if (nextUrl.origin !== baseOrigin || !nextUrl.pathname.startsWith('/api/v0/equity/history/orders')) {
        throw new Error('Trading 212 returned an invalid pagination URL');
      }
      requestUrl = nextUrl.toString();

      const remaining = Number(response.headers?.['x-ratelimit-remaining']);
      if (Number.isFinite(remaining) && remaining <= 0) {
        await this.waitForRateLimitReset(response.headers);
      }
    }

    if (requestUrl) {
      throw new Error('Trading 212 history exceeded the maximum supported page count');
    }

    return executions;
  }

  async requestPage(url, auth, retries = 2) {
    try {
      return await axios.get(url, { auth, timeout: 30000 });
    } catch (error) {
      const status = error.response?.status;
      if (status === 429 && retries > 0) {
        await this.waitForRateLimitReset(error.response?.headers || {});
        return this.requestPage(url, auth, retries - 1);
      }

      if (status === 408 || status === 429 || status >= 500 || !error.response) {
        error.transient = true;
      }
      if (status === 401 || status === 403) {
        throw new Error('Trading 212 authentication failed. Check the API key, secret, and selected environment.');
      }
      throw error;
    }
  }

  async waitForRateLimitReset(headers = {}) {
    const resetSeconds = Number(headers['x-ratelimit-reset']);
    const resetMs = Number.isFinite(resetSeconds) ? (resetSeconds * 1000) - Date.now() : 10000;
    const waitMs = Math.max(250, Math.min(resetMs + 250, MAX_RATE_LIMIT_WAIT_MS));
    await this.sleep(waitMs);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  mapExecutionToFill(item) {
    const fill = item?.fill || {};
    const order = item?.order || {};
    if (fill.type && fill.type !== 'TRADE') return null;

    const symbol = normalizeTicker(order.instrument?.ticker || order.ticker);
    const quantity = Math.abs(Number(fill.quantity || 0));
    const price = fill.price == null ? NaN : Number(fill.price);
    const time = fill.filledAt;
    const action = String(order.side || '').toLowerCase();
    if (!symbol || !quantity || !Number.isFinite(price) || price < 0 || !time || !['buy', 'sell'].includes(action)) return null;

    const taxes = Array.isArray(fill.walletImpact?.taxes) ? fill.walletImpact.taxes : [];
    // Execution price is in instrument currency; walletImpact is in account
    // currency. GBX prices must be divided by 100 before being labelled GBP.
    const instrumentCurrency = order.instrument?.currency;
    if (!instrumentCurrency) {
      throw new Error('Trading 212 execution is missing its instrument currency');
    }
    const priceUnit = normaliseMinorUnit(instrumentCurrency);
    let commission = 0;
    let fees = 0;
    for (const tax of taxes) {
      let amount = numericTaxAmount(tax);
      const taxCurrency = tax.currency || fill.walletImpact?.currency || instrumentCurrency;
      const taxUnit = normaliseMinorUnit(taxCurrency);
      if (taxUnit.code === priceUnit.code) {
        amount /= taxUnit.divisor;
      } else if (taxCurrency === fill.walletImpact?.currency && Number(fill.walletImpact?.fxRate) > 0) {
        // Broker rate expresses instrument units per account-currency unit.
        amount *= Number(fill.walletImpact.fxRate) / priceUnit.divisor;
      } else if (amount !== 0) {
        throw new Error('Trading 212 tax currency cannot be converted to instrument currency');
      }
      if (String(tax?.name || '').toUpperCase() === 'COMMISSION_TURNOVER') {
        commission += amount;
      } else {
        fees += amount;
      }
    }

    return {
      symbol,
      action,
      quantity,
      price: price / priceUnit.divisor,
      time,
      commission,
      fees,
      instrumentType: 'stock',
      accountIdentifier: item._accountIdentifier || null,
      orderId: fill.id != null ? String(fill.id) : (order.id != null ? String(order.id) : null),
      currency: priceUnit.code,
      // The broker rate is not a conversion of these stored prices to USD.
      fxRate: 1,
      accountCurrency: fill.walletImpact?.currency || null,
      brokerFxRate: fill.walletImpact?.fxRate ?? null
    };
  }

  toExecutionData(fill, type) {
    return {
      action: fill.action,
      type,
      quantity: fill.quantity,
      price: fill.price,
      datetime: fill.time,
      commission: fill.commission || 0,
      fees: fill.fees || 0,
      order_id: fill.orderId || null,
      currency: fill.currency || null,
      fx_rate: fill.fxRate ?? null,
      account_currency: fill.accountCurrency || null,
      broker_fx_rate: fill.brokerFxRate ?? null
    };
  }
}

module.exports = new Trading212Service();
module.exports.getApiBase = getApiBase;
module.exports.normalizeTicker = normalizeTicker;
