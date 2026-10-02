jest.mock('axios', () => ({ get: jest.fn() }));

jest.mock('../../src/models/Trade', () => ({ create: jest.fn() }));
jest.mock('../../src/models/BrokerConnection', () => ({
  updateSyncLog: jest.fn(),
  updateStatus: jest.fn()
}));
jest.mock('../../src/services/analyticsCache', () => ({ invalidate: jest.fn() }));
jest.mock('../../src/services/optionStrategyGroupingService', () => ({
  rebuildUserGroupsSafe: jest.fn()
}));
jest.mock('../../src/utils/cache', () => ({ data: {}, del: jest.fn() }));
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

const axios = require('axios');
const trading212Service = require('../../src/services/brokerSync/trading212Service');
const { buildRepair } = require('../../scripts/repair-trading212-import');
const { planSnapshot, validateCoverage } = require('../../src/services/brokerSync/trading212Reconcile');

function historyItem({
  id,
  ticker = 'AAPL_US_EQ',
  side = 'BUY',
  quantity = 2,
  price = 100,
  filledAt = '2026-07-01T14:30:00Z',
  taxes = []
}) {
  return {
    fill: {
      id,
      type: 'TRADE',
      quantity,
      price,
      filledAt,
      walletImpact: {
        currency: 'USD',
        fxRate: 1,
        taxes
      }
    },
    order: {
      id: `order-${id}`,
      side,
      ticker,
      currency: 'USD',
      instrument: { ticker, currency: 'USD' }
    }
  };
}

describe('Trading 212 broker sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validates credentials against the selected environment', async () => {
    axios.get.mockResolvedValue({ data: { id: 12345678, currency: 'GBP' } });

    const result = await trading212Service.validateCredentials('key', 'secret', 'demo');

    expect(result).toEqual(expect.objectContaining({
      valid: true,
      accountId: '12345678',
      currency: 'GBP'
    }));
    expect(axios.get).toHaveBeenCalledWith(
      'https://demo.trading212.com/api/v0/equity/account/summary',
      expect.objectContaining({ auth: { username: 'key', password: 'secret' } })
    );
  });

  test('paginates historical orders and applies the requested date window', async () => {
    axios.get
      .mockResolvedValueOnce({
        data: {
          items: [
            historyItem({ id: 3, filledAt: '2026-07-03T14:30:00Z' }),
            historyItem({ id: 2, filledAt: '2026-07-02T14:30:00Z' })
          ],
          nextPagePath: '/api/v0/equity/history/orders?limit=50&cursor=2'
        },
        headers: { 'x-ratelimit-remaining': '5' }
      })
      .mockResolvedValueOnce({
        data: {
          items: [historyItem({ id: 1, filledAt: '2026-06-30T14:30:00Z' })],
          nextPagePath: null
        },
        headers: { 'x-ratelimit-remaining': '4' }
      });

    const items = await trading212Service.fetchExecutions({
      brokerEnvironment: 'live',
      trading212ApiKey: 'key',
      trading212ApiSecret: 'secret',
      externalAccountId: '12345678'
    }, {
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    });

    expect(items).toHaveLength(1);
    expect(items[0].fill.id).toBe(2);
    expect(items[0]._accountIdentifier).toBe('****5678');
    expect(axios.get.mock.calls[1][0]).toBe(
      'https://live.trading212.com/api/v0/equity/history/orders?limit=50&cursor=2'
    );
  });

  test('maps fills, normalizes tickers, and pairs buy/sell executions', () => {
    const trades = trading212Service.mapExecutionsToTrades([
      historyItem({
        id: 10,
        ticker: 'VUSA_GB_EQ',
        side: 'BUY',
        quantity: 1.5,
        price: 80,
        filledAt: '2026-07-01T09:00:00Z',
        taxes: [{ name: 'COMMISSION_TURNOVER', amount: 0.1 }]
      }),
      historyItem({
        id: 11,
        ticker: 'VUSA_GB_EQ',
        side: 'SELL',
        quantity: 1.5,
        price: 84,
        filledAt: '2026-07-02T09:00:00Z',
        taxes: [{ name: 'STAMP_DUTY', amount: 0.2 }]
      })
    ]);

    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      symbol: 'VUSA.L',
      side: 'long',
      quantity: 1.5,
      entryPrice: 80,
      exitPrice: 84,
      tradeDate: '2026-07-02',
      commission: 0.1,
      fees: 0.2,
      originalCurrency: 'USD',
      exchangeRate: 1
    });
    expect(trades[0].executionData[0]).toMatchObject({
      order_id: '10',
      commission: 0.1,
      fx_rate: 1
    });
  });

  test('ignores non-trade corporate-action fills', () => {
    const item = historyItem({ id: 20 });
    item.fill.type = 'STOCK_SPLIT';
    expect(trading212Service.mapExecutionToFill(item)).toBeNull();
  });

  test('allocates split fills and fees once and retains every execution', () => {
    const raw = [
      historyItem({ id: 101, quantity: 10, taxes: [{ name: 'FEE', quantity: 1 }] }),
      historyItem({ id: 102, side: 'SELL', quantity: 4, filledAt: '2026-07-02T14:30:00Z' }),
      historyItem({ id: 103, side: 'SELL', quantity: 3, filledAt: '2026-07-03T14:30:00Z' })
    ];
    const trades = trading212Service.mapExecutionsToTrades(raw);
    expect(trades.map(t => t.quantity)).toEqual([4, 3, 3]);
    expect(trades.map(t => t.fees)).toEqual([0.4, 0.3, 0.3]);
    for (const t of trades) for (const e of t.executionData) expect(e.quantity).toBe(t.quantity);
    expect(() => validateCoverage(raw, trades)).not.toThrow();
    expect(() => validateCoverage(raw, trades.slice(1))).toThrow('conservation');
    const existing = trades.map((t, i) => ({ ...t, executionData: undefined,
      executions: t.executionData, id: String(i), exit_time: t.exitTime }));
    expect(planSnapshot(trades, existing).every(p => p.old)).toBe(true);
  });

  test('keeps the existing open trade ID when a later fill closes it', () => {
    const buy = historyItem({ id: 201, quantity: 2 });
    const old = trading212Service.mapExecutionsToTrades([buy])[0];
    const desired = trading212Service.mapExecutionsToTrades([buy,
      historyItem({ id: 202, side: 'SELL', quantity: 2, filledAt: '2026-07-02T14:30:00Z' })]);
    const existing = [{ ...old, executionData: undefined, executions: old.executionData, id: 'saved-id', exit_time: null }];
    expect(planSnapshot(desired, existing)[0].old.id).toBe('saved-id');
    expect(() => planSnapshot([], existing)).toThrow('complete history');
  });

  test('retains a zero-price closing fill for a worthless security', () => {
    const raw = [historyItem({ id: 301 }), historyItem({ id: 302, side: 'SELL', price: 0,
      filledAt: '2026-07-02T14:30:00Z' })];
    const trades = trading212Service.mapExecutionsToTrades(raw);
    expect(trades[0].exitPrice).toBe(0);
    expect(() => validateCoverage(raw, trades)).not.toThrow();
  });

  test('does not create open lots from floating point remnants', () => {
    const raw = [historyItem({ id: 401, quantity: 0.3 }),
      historyItem({ id: 402, side: 'SELL', quantity: 0.1, filledAt: '2026-07-02T14:30:00Z' }),
      historyItem({ id: 403, side: 'SELL', quantity: 0.2, filledAt: '2026-07-03T14:30:00Z' })];
    const trades = trading212Service.mapExecutionsToTrades(raw);
    expect(trades).toHaveLength(2);
    expect(trades.every(t => t.exitTime)).toBe(true);
    expect(() => validateCoverage(raw, trades)).not.toThrow();
  });

  test('keeps a USD execution separate from GBP account cash and converts fees', () => {
    const item = historyItem({ id: 30, price: 404.47 });
    item.fill.walletImpact = {
      currency: 'GBP', fxRate: 1.32,
      taxes: [{ name: 'CURRENCY_CONVERSION_FEE', quantity: -0.16, currency: 'GBP' }]
    };
    const mapped = trading212Service.mapExecutionToFill(item);
    expect(mapped).toMatchObject({
      symbol: 'AAPL', price: 404.47, currency: 'USD', fxRate: 1,
      accountCurrency: 'GBP', brokerFxRate: 1.32
    });
    expect(mapped.fees).toBeCloseTo(0.2112);
  });

  test('normalizes London pence prices and pound-denominated stamp duty', () => {
    const item = historyItem({ id: 31, ticker: 'VODl_EQ', price: 9405 });
    item.order.instrument.currency = 'GBX';
    item.fill.walletImpact = {
      currency: 'GBP', fxRate: 100,
      taxes: [{ name: 'STAMP_DUTY', quantity: -0.5, currency: 'GBP' }]
    };
    expect(trading212Service.mapExecutionToFill(item)).toMatchObject({
      symbol: 'VOD.L', price: 94.05, currency: 'GBP', fees: 0.5
    });
  });

  test('does not guess a price currency from account currency', () => {
    const item = historyItem({ id: 32 });
    delete item.order.instrument.currency;
    expect(() => trading212Service.mapExecutionToFill(item)).toThrow('instrument currency');
  });

  test('repairs pence-priced records from matching execution IDs without changing quantity', () => {
    const entry = historyItem({ id: 40, ticker: 'VODl_EQ', quantity: 2, price: 9405 });
    const exit = historyItem({ id: 41, ticker: 'VODl_EQ', side: 'SELL', quantity: 2, price: 9500,
      filledAt: '2026-07-02T14:30:00Z' });
    for (const item of [entry, exit]) {
      item.order.instrument.currency = 'GBX';
      item.fill.walletImpact = { currency: 'GBP', fxRate: 100, taxes: [] };
    }
    const trade = { side:'long', instrument_type:'stock', quantity:2, stop_loss:9000,
      take_profit:10000, executions:[
        {order_id:'40',action:'buy',type:'entry',quantity:2,price:9405,datetime:entry.fill.filledAt},
        {order_id:'41',action:'sell',type:'exit',quantity:2,price:9500,datetime:exit.fill.filledAt}
      ] };
    const repair = buildRepair(trade, new Map([['40',entry],['41',exit]]), 'Europe/London');
    expect(repair).toMatchObject({ symbol:'VOD.L', currency:'GBP', stopLoss:90, takeProfit:100 });
    expect(repair.aggregate.quantity).toBe(2);
    expect(repair.aggregate.entry_price).toBe(94.05);
    expect(repair.aggregate.pnl).toBeCloseTo(1.9);
    const edited = {...trade, executions:trade.executions.map(e=>({...e,price:123}))};
    expect(()=>buildRepair(edited,new Map([['40',entry],['41',exit]]),'UTC')).toThrow('Price edited');
  });
});
