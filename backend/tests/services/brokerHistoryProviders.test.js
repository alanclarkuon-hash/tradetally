jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/models/BrokerConnection', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/brokerSync/etoroService', () => ({ get: jest.fn(), field: (o,k) => o?.[k] }));
const registry = require('../../src/services/brokerHistoryProviders');
const db = require('../../src/config/database');
const BC = require('../../src/models/BrokerConnection');
beforeEach(() => { jest.clearAllMocks(); });
test('adding a broker adapter requires no orchestrator change and uses remaining ranges', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'one', broker_type: 'new-broker' }, { id: 'two', broker_type: 'another' }] });
  BC.findById.mockResolvedValue({});
  let ranges = [{ from: '2026-08-01', to: '2026-08-01' }];
  const first = jest.fn().mockResolvedValue([{ time: Date.parse('2026-08-01') / 1000, close: 1 }]);
  const second = jest.fn();
  registry.adapters.set('new-broker', first); registry.adapters.set('another', second);
  await registry.fetch({ userId: 'owner', symbol: 'COIN', instrumentType: 'crypto', ranges: () => ranges, onPrices: async () => { ranges = []; } });
  expect(first).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-08-01', symbol: 'COIN' }));
  expect(second).not.toHaveBeenCalled();
  registry.adapters.delete('new-broker'); registry.adapters.delete('another');
});
test('a broker failure falls through without disclosing its error object', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'one', broker_type: 'failure-broker' }] });
  BC.findById.mockResolvedValue({});
  registry.adapters.set('failure-broker', async () => { throw Error('secret request headers'); });
  await expect(registry.fetch({ userId: 'owner', symbol: 'COIN', instrumentType: 'crypto', ranges: () => [{ from: '2026-08-01', to: '2026-08-01' }], onPrices: jest.fn() })).resolves.toBeUndefined();
  registry.adapters.delete('failure-broker');
});
test('uncommitted and out-of-range candles never enter broker history', () => {
  const current = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.parse(current)-86400000).toISOString().slice(0,10);
  const result = registry.bounded([registry.candle(Date.parse(current), [1,1,1,1,0]), registry.candle(Date.parse(yesterday), [1,1,1,1,0])], yesterday, current);
  expect(result).toHaveLength(1);
  expect(registry.candle(Date.parse(current), [1,1,1,NaN,0])).toBeNull();
});
test('eToro verifies stable instrument ID, explicit USD units and bounded cursor pages', async () => {
  db.query.mockResolvedValue({ rows: [{ payload: { instruments: [{ instrumentId: 1, symbolFull: 'BTC' }] } }] });
  const etoro = require('../../src/services/brokerSync/etoroService');
  etoro.get.mockResolvedValueOnce({}).mockResolvedValueOnce({ instrumentId: 1, symbol: 'BTC/USD', results: [{ time: '2026-01-01T00:00:00Z', open: 10, high: 10, low: 10, close: 10, volume: 0 }], pagination: { hasNext: false } });
  expect(await registry.etoroCandles({ symbol: 'BTC', instrumentType: 'crypto', from: '2026-01-01', to: '2026-01-01', userId: 'owner', connection: { id: 'conn' } })).toHaveLength(1);
  expect(etoro.get.mock.calls[1][1]).toBe('/data/instruments/1/candles');
});
