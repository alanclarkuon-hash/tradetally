jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/finnhub', () => ({ getStockCandles: jest.fn() }));
jest.mock('../../src/utils/alphaVantage', () => ({ isConfigured: () => true, getDailyData: jest.fn() }));
jest.mock('../../src/utils/historicalPriceCache', () => ({ getRange: jest.fn(), hasRange: jest.fn(), insertCandles: jest.fn() }));
jest.mock('../../src/services/holdingsService', () => ({}));
jest.mock('../../src/services/notificationService', () => ({}));
const PortfolioService = require('../../src/services/portfolioService');
const cache = require('../../src/utils/historicalPriceCache');
const alpha = require('../../src/utils/alphaVantage');
const finnhub = require('../../src/utils/finnhub');
const candle = { time: Date.parse('2026-08-15') / 1000, close: 100 };
beforeEach(() => {
  jest.clearAllMocks();
  cache.getRange.mockResolvedValue([]);
  cache.hasRange.mockResolvedValue(false);
  cache.insertCandles.mockResolvedValue();
});
test('persists Alpha Vantage candles and reuses them on the next request', async () => {
  alpha.getDailyData.mockResolvedValue([candle]);
  expect(await PortfolioService._getDailySeries('MSFT', '2026-08-01', '2026-08-31', 'owner')).toEqual([candle]);
  expect(cache.insertCandles).toHaveBeenCalledWith('MSFT', [candle], 'alphaVantage');
  cache.getRange.mockResolvedValue([
    { ...candle, time: Date.parse('2026-08-01') / 1000 },
    { ...candle, time: Date.parse('2026-08-31') / 1000 }
  ]);
  cache.hasRange.mockResolvedValue(true);
  await PortfolioService._getDailySeries('MSFT', '2026-08-01', '2026-08-31', 'owner');
  expect(alpha.getDailyData).toHaveBeenCalledTimes(1);
  expect(finnhub.getStockCandles).not.toHaveBeenCalled();
});
test('retains available dated prices when both providers fail', async () => {
  cache.getRange.mockResolvedValue([candle]);
  alpha.getDailyData.mockRejectedValue(new Error('unavailable'));
  finnhub.getStockCandles.mockRejectedValue(new Error('unavailable'));
  expect(await PortfolioService._getDailySeries('MSFT', '2026-08-01', '2026-08-31', 'owner')).toEqual([candle]);
});
test('background history returns cached prices immediately, coalesces downloads and cools down failures', async () => {
  let rejectDownload;
  alpha.getDailyData.mockImplementation(() => new Promise((_, reject) => { rejectDownload = reject; }));
  cache.getRange.mockResolvedValue([candle]);
  const options = { background: true };
  expect(await PortfolioService._getDailySeries('BACKGROUND', '2026-08-01', '2026-08-31', 'owner', options)).toEqual([candle]);
  await PortfolioService._getDailySeries('BACKGROUND', '2026-08-01', '2026-08-31', 'owner', options);
  expect(alpha.getDailyData).toHaveBeenCalledTimes(1);
  rejectDownload(new Error('unavailable'));
  finnhub.getStockCandles.mockRejectedValue(new Error('unavailable'));
  await new Promise(resolve => setImmediate(resolve));
  await PortfolioService._getDailySeries('BACKGROUND', '2026-08-01', '2026-08-31', 'owner', options);
  expect(alpha.getDailyData).toHaveBeenCalledTimes(1);
});
test('a compact trailing response does not count as complete coverage of a longer range', async () => {
  cache.getRange.mockResolvedValue([candle]);
  cache.hasRange.mockResolvedValue(true);
  alpha.getDailyData.mockResolvedValue([candle]);
  await PortfolioService._getDailySeries('PARTIAL', '2026-01-01', '2026-08-31', 'owner');
  expect(alpha.getDailyData).toHaveBeenCalledTimes(1);
});
test('incomplete history cannot create or display a drawdown alert', async () => {
  jest.spyOn(PortfolioService, 'getPreferences').mockResolvedValue({ alertsEnabled: true, driftThresholdPercent: 5, drawdownThresholdPercent: 10 });
  jest.spyOn(PortfolioService, 'getRebalancePlan').mockResolvedValue({ positions: [] });
  jest.spyOn(PortfolioService, 'getPerformance').mockResolvedValue({ historyIncomplete: true, metrics: { maxDrawdownPercent: 99 } });
  jest.spyOn(PortfolioService, '_getRecentPortfolioAlerts').mockResolvedValue([]);
  const notify = jest.spyOn(PortfolioService, '_createPortfolioAlert').mockResolvedValue({});
  expect((await PortfolioService.getAlertSummary('owner')).activeConditions).toEqual([]);
  expect(await PortfolioService.evaluateAlerts('owner')).toEqual([]);
  expect(notify).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
test('snapshot backfills wait for history and never persist an incomplete comparison', async () => {
  const db = require('../../src/config/database');
  db.query.mockResolvedValue({ rows: [] });
  const performance = jest.spyOn(PortfolioService, 'getPerformance').mockResolvedValue({ historyIncomplete: true, series: [] });
  const write = jest.spyOn(PortfolioService, '_upsertSnapshotRow').mockResolvedValue({});
  expect((await PortfolioService.backfillSnapshotsForUser('owner', { days: 30 })).snapshotsCreated).toBe(0);
  expect(performance).toHaveBeenCalledWith('owner', expect.objectContaining({ waitForHistory: true }));
  expect(write).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
