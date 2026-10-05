jest.mock('../../src/utils/cache', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../src/utils/historicalPriceCache', () => ({}));
const client = require('../../src/utils/alphaVantage');
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  client.callTimestamps = []; client.dailyCalls = []; client.rateLimitQueue = Promise.resolve();
});
afterEach(() => jest.useRealTimers());
test('parallel callers reserve at most five slots per minute', async () => {
  const jobs = Array.from({length: 12}, () => client.waitForRateLimit());
  await jest.advanceTimersByTimeAsync(0);
  expect(client.dailyCalls).toHaveLength(5);
  await jest.advanceTimersByTimeAsync(61000);
  expect(client.dailyCalls).toHaveLength(10);
  expect(client.callTimestamps).toHaveLength(5);
  await jest.advanceTimersByTimeAsync(61000);
  await Promise.all(jobs);
  expect(client.dailyCalls).toHaveLength(12);
});
test('concurrent reservations cannot pass the daily quota', async () => {
  client.dailyCalls = Array(24).fill(Date.now());
  const jobs = Promise.allSettled([client.waitForRateLimit(), client.waitForRateLimit(), client.waitForRateLimit()]);
  await jest.advanceTimersByTimeAsync(0);
  const results = await jobs;
  expect(results.map(r => r.status)).toEqual(['fulfilled','rejected','rejected']);
  expect(client.dailyCalls).toHaveLength(25);
});
