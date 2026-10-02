jest.mock('axios');
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/models/BrokerConnection', () => ({ updateSyncLog: jest.fn() }));
const axios = require('axios');
const db = require('../../src/config/database');
const { EtoroService, flattenPositions, historyStart } = require('../../src/services/brokerSync/etoroService');

const connection = { id: 'connection', userId: 'owner', externalAccountId: '123',
  brokerEnvironment: 'real', etoroApiKey: 'synthetic-public', etoroUserKey: 'synthetic-user' };
const position = { positionID: 10, instrumentID: 100, units: 0.125 };
const closed = { positionId: 10, instrumentId: 100, orderId: 20,
  closeTimestamp: '2026-09-01T10:00:00Z', units: 0.05 };

beforeEach(() => jest.clearAllMocks());

test('keeps fractional crypto and de-duplicates direct/copied positions', () => {
  expect(flattenPositions({ positions: [position], mirrors: [{ positions: [{ ...position }] }] })).toEqual([position]);
  expect(() => flattenPositions({ positions: [position], mirrors: [{ positions: [{ ...position, units: 2 }] }] })).toThrow('conflicting');
  expect(() => flattenPositions({})).toThrow('incomplete');
});

test('caps old history at the documented lookback without making an invalid request', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  expect(historyStart('2021-01-01', now)).toBe('2025-10-03');
  expect(historyStart('2026-09-01', now)).toBe('2026-09-01');
  expect(() => historyStart('2027-01-01', now)).toThrow('future');
});

test('uses authenticated GET, unique request ID and refuses redirects and write endpoints', async () => {
  axios.get.mockResolvedValue({ data: { realCid: 123 } });
  const service = new EtoroService();
  await service.get(connection, '/me');
  const [url, options] = axios.get.mock.calls[0];
  expect(url).toBe('https://public-api.etoro.com/api/v1/me');
  expect(options.headers).toMatchObject({ 'x-api-key': 'synthetic-public', 'x-user-key': 'synthetic-user' });
  expect(options.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(options.maxRedirects).toBe(0);
  await expect(service.get(connection, '/trading/execution/market-open-orders')).rejects.toThrow('Unsupported');
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test.each([401, 403, 429, 500])('sanitizes failed requests (%s) without exposing keys', async status => {
  axios.get.mockRejectedValue({ response: { status, data: { secret: 'synthetic-user' } },
    message: 'synthetic-public', config: { headers: connection } });
  await expect(new EtoroService().get(connection, '/me')).rejects.not.toThrow(/synthetic/);
});

test('validation checks the real portfolio, rather than accepting identity permission alone', async () => {
  const service = new EtoroService();
  service.get = jest.fn().mockResolvedValueOnce({ realCid: 123 }).mockRejectedValueOnce(new Error('Missing portfolio permission'));
  expect(await service.validateCredentials('key', 'user')).toEqual({ valid: false, message: 'Missing portfolio permission' });
});

test('retains partial closing slices and fails on overlapping pages', async () => {
  const service = new EtoroService();
  service.get = jest.fn().mockResolvedValue([closed, { ...closed, orderId: 21, units: 0.025 }]);
  expect(await service.fetchHistory(connection)).toHaveLength(2);
  service.get.mockResolvedValue([closed, closed]);
  await expect(service.fetchHistory(connection)).rejects.toThrow('overlap');
});

function stagedService() {
  const service = new EtoroService();
  service.get = jest.fn(async (_connection, path) => ({
    '/me': { realCid: 123 },
    '/trading/info/real/pnl': { clientPortfolio: { credit: 500, positions: [position], mirrors: [] } },
    '/trading/info/trade/history': [closed],
    '/market-data/instruments': { instrumentDisplayDatas: [{ instrumentID: 100, symbolFull: 'BTC', instrumentTypeID: 10 }] },
    '/market-data/instrument-types': { instrumentTypes: [{ instrumentTypeID: 10, instrumentTypeDescription: 'Crypto' }] }
  }[path]));
  return service;
}

test('stages a complete private snapshot, scoped to its owner, without writing report tables', async () => {
  const result = await stagedService().syncTrades(connection);
  expect(result.imported).toBe(0);
  expect(result.warnings.join(' ')).toContain('not yet been added');
  expect(db.query).toHaveBeenCalledTimes(1);
  const [sql, args] = db.query.mock.calls[0];
  expect(sql).toContain('INSERT INTO broker_import_snapshots');
  expect(args.slice(0, 3)).toEqual(['owner', 'etoro:123', 'connection']);
  const snapshot = JSON.parse(args[3]);
  expect(snapshot.history).toEqual([closed]);
  expect(snapshot.positions).toEqual([position]);
  expect(snapshot).not.toHaveProperty('etoroApiKey');
});

test('an incomplete fetch cannot replace an existing snapshot', async () => {
  const service = stagedService();
  const original = service.get;
  service.get = jest.fn((c, path, params) => path === '/market-data/instruments'
    ? Promise.resolve({ instrumentDisplayDatas: [] }) : original(c, path, params));
  await expect(service.syncTrades(connection)).rejects.toThrow('incomplete');
  expect(db.query).not.toHaveBeenCalled();
});

test('changed account identity stops before fetching or saving financial data', async () => {
  const service = stagedService();
  service.get.mockResolvedValue({ realCid: 456 });
  await expect(service.syncTrades(connection)).rejects.toThrow('identity changed');
  expect(service.get).toHaveBeenCalledTimes(1);
  expect(db.query).not.toHaveBeenCalled();
});
