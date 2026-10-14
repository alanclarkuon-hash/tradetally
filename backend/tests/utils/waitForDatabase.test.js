const { waitForDatabase } = require('../../src/utils/waitForDatabase');

function setup() {
  let time = 0;
  const db = { pool: { query: jest.fn() } };
  const log = jest.fn();
  const sleep = jest.fn(async ms => { time += ms; });
  return { db, log, sleep, options: { timeoutMs: 4000, retryMs: 2000, now: () => time, sleep, log } };
}

test('readiness requires a successful authenticated query, not an open TCP port', async () => {
  const { db, options, log, sleep } = setup();
  db.pool.query.mockRejectedValueOnce(Object.assign(new Error('database is starting up'), { code: '57P03' })).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  await expect(waitForDatabase(db, options)).resolves.toBe(2);
  expect(db.pool.query).toHaveBeenCalledWith({ text: 'SELECT 1', query_timeout: 4000 });
  expect(sleep).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenLastCalledWith('[OK] Database accepts authenticated queries');
});

test('an already-ready database starts immediately without sleeping', async () => {
  const { db, options, sleep } = setup();
  db.pool.query.mockResolvedValue({ rows: [] });
  await expect(waitForDatabase(db, options)).resolves.toBe(1);
  expect(sleep).not.toHaveBeenCalled();
});

test('persistent failures stop after the bounded readiness deadline', async () => {
  const { db, options, sleep } = setup();
  db.pool.query.mockRejectedValue(Object.assign(new Error('private connection detail'), { code: 'ECONNREFUSED' }));
  await expect(waitForDatabase(db, options)).rejects.toThrow('Database readiness timed out');
  expect(db.pool.query).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls).toEqual([[2000], [2000]]);
});

test('retry diagnostics never expose server messages or malformed codes', async () => {
  const { db, options, log } = setup();
  db.pool.query.mockRejectedValueOnce(Object.assign(new Error('secret fixture'), { code: 'password=secret fixture' })).mockResolvedValue({ rows: [] });
  await waitForDatabase(db, options);
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret fixture');
  expect(log).toHaveBeenCalledWith('[WAIT] Database is not ready (unavailable); retrying...');
});
