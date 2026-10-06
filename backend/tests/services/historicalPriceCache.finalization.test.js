jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
const db = require('../../src/config/database');
const cache = require('../../src/utils/historicalPriceCache');
beforeEach(() => { jest.clearAllMocks(); db.query.mockResolvedValue({ rows: [] }); });
test('only provisional historical rows can be replaced by finalized daily closes', async () => {
  await cache.insertCandles('CRYPTO:BTC', [{ time: Date.parse('2026-01-01')/1000, open: 1, high: 1, low: 1, close: 1, volume: 0 }], 'kraken');
  expect(db.query.mock.calls[0][0]).toContain('WHERE NOT historical_prices.is_final');
  expect(db.query.mock.calls[0][1].at(-1)).toBe(true);
});
test('live quotes remain provisional and yesterday provisional quotes are excluded from history reads', async () => {
  await cache.upsertToday('MSFT', { close: 1 }, 'finnhub');
  expect(db.query.mock.calls[0][0]).toContain('WHERE NOT historical_prices.is_final');
  await cache.getRange('MSFT','2026-01-01','2026-01-02');
  expect(db.query.mock.calls[1][0]).toContain('(is_final OR price_date=CURRENT_DATE)');
});
test('crypto namespaces remain canonical and stale last closes do not create today candles',async()=>{
  await cache.upsertToday('CRYPTO:SUI',{c:2,asOf:new Date().toISOString()},'broker:kraken:crypto');
  expect(db.query.mock.calls[0][1][0]).toBe('crypto:SUI');
  expect(db.query.mock.calls[0][0]).toContain('historical_prices.observed_at<=$9::timestamptz');
  db.query.mockClear();
  await cache.upsertToday('MSFT',{c:1,asOf:'2020-01-01T12:00:00Z'},'finnhub');
  expect(db.query).not.toHaveBeenCalled();
});
