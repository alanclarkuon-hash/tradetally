/**
 * News Service
 * Handles fetching and caching company news for the dashboard
 *
 * - Fetches company news from Finnhub for open position symbols
 * - Caches results in dashboard_news_cache table
 * - Serves cached news to dashboard for instant loading
 */

const db = require('../config/database');
const finnhub = require('../utils/finnhub');
const NewsNotificationService = require('./newsNotificationService');

const LOG_PREFIX = '[NEWS-SERVICE]';

// Cache staleness threshold (1 hour)
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

// Delay between Finnhub API calls to respect rate limits (300ms)
const API_DELAY_MS = 300;

function normalizeSymbols(symbols) {
  return [...new Set((symbols || [])
    .map(symbol => String(symbol).trim().toUpperCase())
    .filter(Boolean))];
}

class NewsService {
  static newsChanged(previousItems, nextItems) {
    const previous = Array.isArray(previousItems) ? previousItems : [];
    const next = Array.isArray(nextItems) ? nextItems : [];

    if (previous.length !== next.length) return true;

    return previous.some((item, index) => {
      const candidate = next[index] || {};
      return item.id !== candidate.id ||
        item.datetime !== candidate.datetime ||
        item.headline !== candidate.headline;
    });
  }

  static isUnsupportedNewsSymbol(symbol) {
    const normalized = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    if (!normalized) return true;

    // Finnhub company news is reliable for equity-style symbols, not option/futures/qualified market pairs.
    return normalized.length > 20 ||
      /\s/.test(normalized) ||
      /[:_!/]/.test(normalized) ||
      /(USDT|USDC|BUSD)$/.test(normalized) ||
      finnhub.isCryptoSymbol(normalized);
  }

  /**
   * Get all distinct symbols with open trades or in watchlists across all users
   */
  static async getAllTrackedSymbols() {
    const query = `
      SELECT DISTINCT symbol FROM (
        SELECT symbol FROM trades
        WHERE exit_price IS NULL AND symbol IS NOT NULL AND symbol != ''
        UNION
        SELECT symbol FROM watchlist_items
        WHERE symbol IS NOT NULL AND symbol != ''
      ) combined
      ORDER BY symbol
    `;

    const result = await db.query(query);
    return result.rows.map(row => row.symbol);
  }

  /**
   * Find users whose open positions or watchlists contain any supplied symbol.
   * The scheduler uses this to send one silent refresh per affected account,
   * rather than one push per headline or symbol.
   */
  static async getUserIdsTrackingSymbols(symbols) {
    const normalized = [...new Set((symbols || [])
      .map(symbol => String(symbol).trim().toUpperCase())
      .filter(Boolean))];
    if (normalized.length === 0) return [];

    const result = await db.query(
      `SELECT DISTINCT user_id FROM (
         SELECT t.user_id
         FROM trades t
         WHERE t.exit_price IS NULL
           AND UPPER(t.symbol) = ANY($1::text[])
         UNION
         SELECT w.user_id
         FROM watchlists w
         JOIN watchlist_items wi ON wi.watchlist_id = w.id
         WHERE UPPER(wi.symbol) = ANY($1::text[])
       ) tracked_users
       WHERE user_id IS NOT NULL`,
      [normalized]
    );

    return result.rows.map(row => row.user_id);
  }

  /**
   * Get cached news for a list of symbols
   */
  static async getCachedNews(symbols) {
    const normalized = normalizeSymbols(symbols);
    if (normalized.length === 0) return [];

    const placeholders = normalized.map((_, i) => `$${i + 1}`).join(',');
    const query = `
      SELECT UPPER(symbol) AS symbol, news_items, fetched_at
      FROM dashboard_news_cache
      WHERE UPPER(symbol) IN (${placeholders})
    `;

    const result = await db.query(query, normalized);
    return result.rows;
  }

  /**
   * Fetch news from Finnhub for a single symbol and update cache
   */
  static async fetchAndCacheSymbol(symbol) {
    try {
      symbol = String(symbol || '').trim().toUpperCase();
      if (this.isUnsupportedNewsSymbol(symbol)) {
        await db.query(
          `INSERT INTO dashboard_news_cache (symbol, news_items, fetched_at)
           VALUES ($1, '[]'::jsonb, NOW())
           ON CONFLICT (symbol)
           DO UPDATE SET news_items = '[]'::jsonb, fetched_at = NOW()`,
          [symbol]
        );
        return [];
      }

      const news = await finnhub.getCompanyNews(symbol);

      // Filter to last 7 days and limit to 5 per symbol
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const filtered = news
        .filter(item => {
          const newsDate = new Date(item.datetime * 1000);
          return newsDate >= sevenDaysAgo;
        })
        .slice(0, 5)
        .map(item => ({ ...item, symbol }));

      // Upsert into cache
      await db.query(
        `INSERT INTO dashboard_news_cache (symbol, news_items, fetched_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (symbol)
         DO UPDATE SET news_items = $2, fetched_at = NOW()`,
        [symbol, JSON.stringify(filtered)]
      );

      try {
        await NewsNotificationService.publishForSymbol(symbol, filtered);
      } catch (error) {
        // News remains available if notification storage is temporarily down.
        // Delivery receipts let the next fetch safely retry these articles.
        console.error(`${LOG_PREFIX} Failed to publish news notifications for ${symbol}:`, error.message);
      }

      return filtered;
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to fetch news for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch and cache news for multiple symbols with rate limiting
   */
  static async fetchAndCacheAll(symbols) {
    let fetched = 0;
    let skipped = 0;
    let errors = 0;
    const changedSymbols = [];
    const failedSymbols = [];

    const normalized = normalizeSymbols(symbols);

    for (const symbol of normalized) {
      const force = this._forcedBackgroundSymbols.delete(symbol);
      const outcome = await this.refreshSymbolIfStale(symbol, { force });
      if (outcome.status === 'fetched') {
        fetched++;
        if (outcome.changed) changedSymbols.push(symbol);
      } else if (outcome.status === 'skipped' || outcome.status === 'coalesced') {
        skipped++;
      } else {
        errors++;
        failedSymbols.push(symbol);
      }

      // Rate limit delay between API calls
      if (normalized.indexOf(symbol) < normalized.length - 1) {
        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
      }
    }

    return { fetched, skipped, errors, total: normalized.length, changedSymbols, failedSymbols };
  }

  static async refreshSymbolIfStale(symbol, { force = false } = {}) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if ((this._retryAfter.get(normalized) || 0) > Date.now()) return { status: 'error', changed: false };
    const existing = this._inFlightRefreshes.get(normalized);
    if (existing) {
      const outcome = await existing;
      return outcome.status === 'error'
        ? outcome
        : { status: 'coalesced', changed: false };
    }

    const refresh = (async () => {
      try {
        const cached = await db.query(
          `SELECT fetched_at, news_items FROM dashboard_news_cache
           WHERE UPPER(symbol) = $1
             AND fetched_at > NOW() - ($2::bigint * INTERVAL '1 millisecond')`,
          [normalized, CACHE_MAX_AGE_MS]
        );
        if (!force && cached.rows.length > 0) return { status: 'skipped', changed: false };

        const previous = await db.query(
          'SELECT news_items FROM dashboard_news_cache WHERE UPPER(symbol) = $1 ORDER BY fetched_at DESC LIMIT 1',
          [normalized]
        );
        const previousItems = previous.rows[0]?.news_items || [];
        const result = await this.fetchAndCacheSymbol(normalized);
        if (result === null) {
          this._retryAfter.set(normalized, Date.now() + CACHE_MAX_AGE_MS);
          return { status: 'error', changed: false };
        }
        this._retryAfter.delete(normalized);
        return {
          status: 'fetched',
          changed: this.newsChanged(previousItems, result)
        };
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed background refresh for ${normalized}:`, error.message);
        return { status: 'error', changed: false, error: error.message };
      }
    })();

    this._inFlightRefreshes.set(normalized, refresh);
    try {
      return await refresh;
    } finally {
      this._inFlightRefreshes.delete(normalized);
    }
  }

  /**
   * Queue stale widget symbols for a best-effort refresh after the current
   * HTTP response can complete. Requests are deduplicated in-process and the
   * drain uses fetchAndCacheAll's existing provider pacing.
   */
  static requestBackgroundRefresh(symbols, { reason = 'unspecified', force = false } = {}) {
    const supported = normalizeSymbols(symbols)
      .filter(symbol => !this.isUnsupportedNewsSymbol(symbol) && (this._retryAfter.get(symbol) || 0) <= Date.now());
    let enqueued = 0;
    let deduplicated = 0;
    for (const symbol of supported) {
      if (this._pendingBackgroundSymbols.has(symbol) || this._activeBackgroundSymbols.has(symbol) || this._inFlightRefreshes.has(symbol)) {
        deduplicated++;
        continue;
      }
      this._pendingBackgroundSymbols.add(symbol);
      if (force) this._forcedBackgroundSymbols.add(symbol);
      enqueued++;
    }

    if (enqueued > 0) {
      console.log(`${LOG_PREFIX} Queued ${enqueued} stale symbol(s) for ${reason}`);
      this._scheduleBackgroundDrain();
    }
    return { enqueued, deduplicated };
  }

  static _scheduleBackgroundDrain() {
    if (this._backgroundDrainPromise) return;
    this._backgroundDrainPromise = new Promise(resolve => setImmediate(resolve))
      .then(async () => {
        const symbols = [...this._pendingBackgroundSymbols];
        this._pendingBackgroundSymbols.clear();
        this._activeBackgroundSymbols = new Set(symbols);
        if (symbols.length === 0) return null;
        const summary = await this.fetchAndCacheAll(symbols);
        if (summary.errors > 0) {
          console.error(`${LOG_PREFIX} On-demand refresh completed with ${summary.errors} error(s)`);
        }
        return summary;
      })
      .catch(error => {
        console.error(`${LOG_PREFIX} On-demand refresh failed:`, error.message);
        return null;
      })
      .finally(() => {
        this._activeBackgroundSymbols.clear();
        this._backgroundDrainPromise = null;
        if (this._pendingBackgroundSymbols.size > 0) this._scheduleBackgroundDrain();
      });
  }

  static async waitForBackgroundRefreshes() {
    while (this._backgroundDrainPromise) {
      await this._backgroundDrainPromise;
    }
  }

  // HTTP reads never wait for a provider call. Failed symbols retain their
  // previous stories and are retried at most hourly, including manual refresh.
  static async getNewsForSymbols(symbols, { force = false } = {}) {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) return [];
    const cached = await this.getCachedNews(normalized);
    const stale = normalized.filter(symbol => {
      const row = cached.find(entry => entry.symbol === symbol);
      return force || !row || Date.now() - new Date(row.fetched_at).getTime() >= CACHE_MAX_AGE_MS;
    });
    if (finnhub.isConfigured()) {
      this.requestBackgroundRefresh(stale, { reason: 'dashboard_news', force });
    }
    return cached.flatMap(row => Array.isArray(row.news_items)
      ? row.news_items.map(item => ({ ...item, symbol: row.symbol })) : [])
      .sort((a, b) => b.datetime - a.datetime);
  }

  static isRefreshPending(symbols) {
    return normalizeSymbols(symbols).some(symbol =>
      this._pendingBackgroundSymbols.has(symbol) || this._activeBackgroundSymbols.has(symbol) || this._inFlightRefreshes.has(symbol));
  }

  static async refreshNewsForSymbols(symbols) {
    return this.getNewsForSymbols(symbols, { force: true });
  }

}

NewsService._activeBackgroundSymbols = new Set();
NewsService._retryAfter = new Map();
NewsService._forcedBackgroundSymbols = new Set();
NewsService._inFlightRefreshes = new Map();
NewsService._pendingBackgroundSymbols = new Set();
NewsService._backgroundDrainPromise = null;

module.exports = NewsService;
