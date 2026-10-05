jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../src/services/newsNotificationService', () => ({
  publishForSymbol: jest.fn().mockResolvedValue(0)
}));

jest.mock('../../src/utils/finnhub', () => ({
  getCompanyNews: jest.fn(),
  isCryptoSymbol: jest.fn().mockReturnValue(false),
  isConfigured: jest.fn().mockReturnValue(true)
}));

const db = require('../../src/config/database');
const finnhub = require('../../src/utils/finnhub');
const NewsService = require('../../src/services/newsService');
const NewsNotificationService = require('../../src/services/newsNotificationService');

describe('NewsService widget refresh tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NewsService._retryAfter.clear();
  });

  afterEach(async () => {
    await NewsService.waitForBackgroundRefreshes();
  });

  test('detects a changed top story', () => {
    expect(NewsService.newsChanged(
      [{ id: 1, datetime: 100, headline: 'Old' }],
      [{ id: 2, datetime: 200, headline: 'New' }]
    )).toBe(true);
    expect(NewsService.newsChanged(
      [{ id: 1, datetime: 100, headline: 'Same' }],
      [{ id: 1, datetime: 100, headline: 'Same' }]
    )).toBe(false);
  });

  test('returns changed symbols after refreshing stale cache entries', async () => {
    const now = Math.floor(Date.now() / 1000);
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ news_items: [{ id: 1, datetime: now - 100, headline: 'Old' }] }]
      })
      .mockResolvedValueOnce({ rows: [] });
    finnhub.getCompanyNews.mockResolvedValue([
      { id: 2, datetime: now, headline: 'New', source: 'Reuters' }
    ]);

    const summary = await NewsService.fetchAndCacheAll(['AAPL']);

    expect(summary).toEqual(expect.objectContaining({
      fetched: 1,
      errors: 0,
      changedSymbols: ['AAPL']
    }));
    expect(NewsNotificationService.publishForSymbol).toHaveBeenCalledWith('AAPL', [
      expect.objectContaining({ id: 2, symbol: 'AAPL', headline: 'New' })
    ]);
  });

  test('keeps fetched news available when notification delivery fails', async () => {
    const article = { id: 4, datetime: Math.floor(Date.now() / 1000), headline: 'Latest' };
    db.query.mockResolvedValueOnce({ rows: [] });
    finnhub.getCompanyNews.mockResolvedValueOnce([article]);
    NewsNotificationService.publishForSymbol.mockRejectedValueOnce(new Error('storage unavailable'));

    expect(await NewsService.fetchAndCacheSymbol('AAPL')).toEqual([
      { ...article, symbol: 'AAPL' }
    ]);
  });

  test('coalesces users tracking changed symbols across positions and watchlists', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }, { user_id: 'user-2' }] });

    const users = await NewsService.getUserIdsTrackingSymbols(['aapl', 'AAPL', ' msft ']);

    expect(users).toEqual(['user-1', 'user-2']);
    expect(db.query.mock.calls[0][1]).toEqual([['AAPL', 'MSFT']]);
  });

  test('deduplicates non-blocking stale refresh requests', async () => {
    const now = Math.floor(Date.now() / 1000);
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    finnhub.getCompanyNews.mockResolvedValue([
      { id: 3, datetime: now, headline: 'Fresh', source: 'Reuters' }
    ]);

    const first = NewsService.requestBackgroundRefresh(['voo'], { reason: 'widget_snapshot_stale' });
    const second = NewsService.requestBackgroundRefresh(['VOO'], { reason: 'widget_snapshot_stale' });

    expect(first).toEqual({ enqueued: 1, deduplicated: 0 });
    expect(second).toEqual({ enqueued: 0, deduplicated: 1 });
    expect(finnhub.getCompanyNews).not.toHaveBeenCalled();

    await NewsService.waitForBackgroundRefreshes();

    expect(finnhub.getCompanyNews).toHaveBeenCalledTimes(1);
    expect(finnhub.getCompanyNews).toHaveBeenCalledWith('VOO');
  });

  test('treats VOO as a supported company-news symbol without inventing a market fallback', () => {
    expect(NewsService.isUnsupportedNewsSymbol('VOO')).toBe(false);
  });

  test('reports failed symbols for persisted scheduler diagnostics', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    finnhub.getCompanyNews.mockRejectedValue(new Error('provider unavailable'));

    const summary = await NewsService.fetchAndCacheAll(['VOO']);

    expect(summary).toEqual(expect.objectContaining({
      errors: 1,
      failedSymbols: ['VOO']
    }));
  });
});


describe('dashboard cache-first news', () => {
  beforeEach(() => { jest.clearAllMocks(); NewsService._retryAfter.clear(); });
  afterEach(() => jest.restoreAllMocks());

  test('returns cached articles without waiting for uncached symbols or a slow provider', async () => {
    const article = { id: 1, datetime: 100, headline: 'Cached' };
    db.query.mockResolvedValueOnce({ rows: [{ symbol: 'MSFT', news_items: [article], fetched_at: new Date() }] });
    const queued = jest.spyOn(NewsService, 'requestBackgroundRefresh').mockReturnValue({ enqueued: 1 });
    finnhub.getCompanyNews.mockImplementation(() => new Promise(() => {}));
    expect(await NewsService.getNewsForSymbols(['msft', 'MSFT', 'TEST.L'])).toEqual([{ ...article, symbol: 'MSFT' }]);
    expect(queued).toHaveBeenCalledWith(['TEST.L'], { reason: 'dashboard_news', force: false });
    expect(finnhub.getCompanyNews).not.toHaveBeenCalled();
  });

  test('manual refresh returns existing stories and queues a forced refresh', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ symbol: 'MSFT', news_items: [], fetched_at: new Date() }] });
    const queued = jest.spyOn(NewsService, 'requestBackgroundRefresh').mockReturnValue({ enqueued: 1 });
    expect(await NewsService.refreshNewsForSymbols(['MSFT'])).toEqual([]);
    expect(queued).toHaveBeenCalledWith(['MSFT'], { reason: 'dashboard_news', force: true });
    expect(finnhub.getCompanyNews).not.toHaveBeenCalled();
  });

  test('failed provider requests retain old articles and throttle retries even when forced', async () => {
    db.query.mockResolvedValue({ rows: [] });
    finnhub.getCompanyNews.mockRejectedValue(new Error('403 unsupported resource'));
    expect(await NewsService.refreshSymbolIfStale('TEST.L')).toEqual({ status: 'error', changed: false });
    expect(await NewsService.refreshSymbolIfStale('TEST.L', { force: true })).toEqual({ status: 'error', changed: false });
    expect(finnhub.getCompanyNews).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
    expect(NewsService.requestBackgroundRefresh(['TEST.L'])).toEqual({ enqueued: 0, deduplicated: 0 });
    NewsService._retryAfter.set('TEST.L', Date.now() - 1);
    await NewsService.refreshSymbolIfStale('TEST.L');
    expect(finnhub.getCompanyNews).toHaveBeenCalledTimes(2);
  });

  test('pending status includes symbols waiting behind another provider call', () => {
    NewsService._activeBackgroundSymbols.add('TEST.L');
    expect(NewsService.isRefreshPending(['test.l'])).toBe(true);
    expect(NewsService.requestBackgroundRefresh(['TEST.L'])).toEqual({ enqueued: 0, deduplicated: 1 });
    NewsService._activeBackgroundSymbols.clear();
    expect(NewsService.isRefreshPending(['TEST.L'])).toBe(false);
  });
});
