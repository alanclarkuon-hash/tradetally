jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/finnhub', () => ({ apiKey: 'synthetic-key', getForexRate: jest.fn() }));
jest.mock('../../src/services/manualFxService', () => ({ getRateMap: jest.fn().mockResolvedValue({ GBP: 0.9 }) }));
const db = require('../../src/config/database');
const finnhub = require('../../src/utils/finnhub');
const fx = require('../../src/utils/currencyConverter');
beforeEach(() => { jest.clearAllMocks(); fx.clearRateCache(); });

test('published dated maps precede provider calls and present-day manual overrides', async () => {
  db.query.mockResolvedValue({ rows: [{ rates: { USD: 1, GBP: 0.72, EUR: 0.85 } }] });
  expect(await fx.getForexRate('USD', 'GBP', '2025-01-01')).toBe(0.72);
  expect(await fx.getForexRate('USD', 'EUR', '2025-01-01')).toBe(0.85);
  expect(await fx.getForexRate('USD', 'GBP', '2025-01-01')).toBe(0.72);
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][1]).toEqual(['USD', '2025-01-01']);
  expect(finnhub.getForexRate).not.toHaveBeenCalled();
});

test('missing historical snapshots retain the existing provider fallback', async () => {
  db.query.mockResolvedValue({ rows: [] });
  finnhub.getForexRate.mockResolvedValue(0.73);
  expect(await fx.getForexRate('USD', 'GBP', '2025-01-02')).toBe(0.73);
  expect(finnhub.getForexRate).toHaveBeenCalledWith('USD', 'GBP', '2025-01-02');
});

test('invalid stored rates cannot silently bypass provider resolution', async () => {
  db.query.mockResolvedValue({ rows: [{ rates: { GBP: -1 } }] });
  finnhub.getForexRate.mockResolvedValue(0.75);
  expect(await fx.getForexRate('USD', 'GBP', '2025-01-03')).toBe(0.75);
});

test('current lookups continue to honour administrator overrides', async () => {
  expect(await fx.getForexRate('USD', 'GBP')).toBe(0.9);
  expect(db.query).not.toHaveBeenCalled();
  expect(finnhub.getForexRate).not.toHaveBeenCalled();
});
