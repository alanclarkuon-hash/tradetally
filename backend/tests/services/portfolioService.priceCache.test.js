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
  cache.getRange.mockResolvedValue([candle]);
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
