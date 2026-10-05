jest.mock('../../src/config/database', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../src/services/portfolioService', () => ({ _getPositionComponents: jest.fn(), _getDailySeries: jest.fn() }));
jest.mock('../../src/services/brokerPortfolioMaintenance', () => ({ maintain: jest.fn() }));
jest.mock('../../src/utils/jobQueue', () => ({ startProcessing: jest.fn(), notifyJobEnqueued: jest.fn() }));
jest.mock('../../src/services/analyticsCache', () => ({ invalidate: jest.fn() }));
const db = require('../../src/config/database');
const portfolio = require('../../src/services/portfolioService');
const service = require('../../src/services/historyBackfillService');
beforeEach(() => { jest.clearAllMocks(); db.query.mockResolvedValue({ rows: [] }); });
test('merges overlapping requirements without dropping older or closed instrument history', () => {
  const tasks = new Map();
  service.addTask(tasks, 'BTC', 'crypto', '2025-01-01', '2025-02-01');
  service.addTask(tasks, 'BTC', 'crypto', '2026-01-01', '2026-02-01');
  service.addTask(tasks, 'BTC', 'stock', '2026-01-01', '2026-02-01');
  expect([...tasks.values()]).toHaveLength(2);
  expect(tasks.get('crypto:BTC')).toMatchObject({ from: '2025-01-01', to: '2026-02-01' });
});
test('pending requests are deduplicated in a database transaction and wake the worker', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'existing' }] }) };
  db.withTransaction.mockImplementation(fn => fn(client));
  expect(await service.enqueue('owner')).toBe('existing');
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(require('../../src/utils/jobQueue').notifyJobEnqueued).toHaveBeenCalledWith([service.TYPE]);
});
test('resume keeps completed tasks, reports missing dates and runs reconstruction after downloads', async () => {
  portfolio._getDailySeries.mockResolvedValue([]);
  require('../../src/services/brokerPortfolioMaintenance').maintain.mockResolvedValue({ warnings: [] });
  const result = await service.process({ id: 'job', user_id: 'owner', result: {
    tasks: [{ symbol: 'BTC', instrumentType: 'crypto', from: '2026-01-01', to: '2026-01-02' }, { symbol: 'ETH', instrumentType: 'crypto', from: '2026-01-01', to: '2026-01-02' }],
    processed: 1, complete: 1, gaps: [], total: 2, stage: 'prices'
  } });
  expect(portfolio._getDailySeries).toHaveBeenCalledTimes(1);
  expect(portfolio._getDailySeries.mock.calls[0][0]).toBe('ETH');
  expect(result).toMatchObject({ processed: 2, complete: 1, stage: 'finished', gaps: [{ symbol: 'ETH' }] });
  expect(require('../../src/services/brokerPortfolioMaintenance').maintain).toHaveBeenCalledWith('owner', { fetchPrices: true });
});
test('status is scoped to the authenticated user and excludes task plans and credentials', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'job', status: 'processing', result: { tasks: [{ secret: 'hidden' }], processed: 1, total: 2, gaps: [] } }] });
  const result = await service.status('owner');
  expect(db.query.mock.calls[0][1]).toEqual(['owner', service.TYPE]);
  expect(result[0].tasks).toBeUndefined();
});
test('dedicated worker claims only history jobs atomically without enrichment timeouts', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'history' }] });
  expect(await service.claim()).toEqual({ id: 'history' });
  expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
  expect(db.query.mock.calls[0][1]).toEqual([service.TYPE]);
  const config = require('../../src/utils/jobQueueConfig');
  expect(config.DEDICATED_JOB_TYPES).toContain(service.TYPE);
  expect(config.PARALLEL_JOB_TYPES).not.toContain(service.TYPE);
});
