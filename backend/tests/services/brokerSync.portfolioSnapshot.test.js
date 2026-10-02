jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/currencyConverter', () => ({ getDailyCrossRate: jest.fn() }));
jest.mock('../../src/services/brokerSync/trading212Service', () => ({ normalizeTicker: t => t === 'INTLl_EQ' ? 'INTL.L' : t.replace('_US_EQ', '') }));
const db = require('../../src/config/database');
const fx = require('../../src/utils/currencyConverter');
const { saveTrading212Snapshot, snapshotPositions, dashboardPositions } = require('../../src/services/brokerSync/portfolioSnapshot');

describe('broker-reported holdings', () => {
  beforeEach(() => jest.clearAllMocks());
  test('dashboard replaces stale broker lots, including false shorts, and keeps other brokers', () => {
    const trades = [
      { id: 'old', broker: 'trading212', account_identifier: '****1234', symbol: 'APH', side: 'long', quantity: 2, entry_price: 80, original_currency: 'USD' },
      { broker: 'trading212', account_identifier: '****1234', symbol: 'TWOU', side: 'long', quantity: 31, entry_price: 2, original_currency: 'USD' },
      { broker: 'trading212', account_identifier: '****1234', symbol: 'NVDA', side: 'short', quantity: 4, entry_price: 100, original_currency: 'USD' },
      { id: 'other', broker: 'ibkr', symbol: 'AAPL', side: 'long', quantity: 1, entry_price: 100, original_currency: 'USD' }
    ];
    const rows = [{ broker_type: 'trading212', account_identifier: '****1234', synced_at: '2026-10-02T12:00:00Z', positions: [{
      instrument: { ticker: 'APH_US_EQ' }, quantity: 6.8,
      walletImpact: { currency: 'GBP', totalCost: 400, currentValue: 450 }
    }] }];
    const positions = Object.values(dashboardPositions(trades, rows));
    expect(positions).toHaveLength(2);
    expect(positions.find(p => p.symbol === 'APH')).toMatchObject({ totalQuantity: 6.8, totalCost: 400, currency: 'GBP', trades: [trades[0]] });
    expect(positions.find(p => p.symbol === 'AAPL').trades[0].id).toBe('other');
    expect(Object.values(dashboardPositions(trades, [{ ...rows[0], positions: [] }])).map(p => p.symbol)).toEqual(['AAPL']);
  });
  test('uses account cash cost and value for pence listings, preserving share count', async () => {
    fx.getDailyCrossRate.mockResolvedValue(1.25);
    const rows = [{ account_identifier: '****1234', synced_at: '2026-10-02T12:00:00Z', positions: [{
      instrument: { ticker: 'INTLl_EQ', currency: 'GBX' }, quantity: 2,
      averagePricePaid: 8000, currentPrice: 9000,
      walletImpact: { currency: 'GBP', totalCost: 160, currentValue: 180 }
    }] }];
    const result = await snapshotPositions(rows);
    expect(result[0]).toMatchObject({ symbol: 'INTL.L', totalShares: 2,
      totalCostBasis: 200, averageCostBasis: 100, brokerCurrentPrice: 112.5 });
    expect(await snapshotPositions(rows, ['****9999'])).toEqual([]);
  });
  test('stores an empty broker portfolio to suppress stale historic holdings', async () => {
    await saveTrading212Snapshot({ userId: 'owner', id: 'connection', externalAccountId: '1234' }, []);
    expect(db.query.mock.calls[0][1]).toEqual(['owner', '****1234', 'connection', '[]']);
  });
  test('rejects incomplete values instead of showing invented cost basis', async () => {
    await expect(saveTrading212Snapshot({ externalAccountId: '1234' }, [{ instrument: { ticker: 'AAPL_US_EQ' }, quantity: 1 }]))
      .rejects.toThrow('Incomplete');
    expect(db.query).not.toHaveBeenCalled();
  });
});
