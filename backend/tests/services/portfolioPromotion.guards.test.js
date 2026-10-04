jest.mock('node:fs', () => ({ readFileSync: jest.fn() }));
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../scripts/rehearsePortfolioPromotion', () => ({ applyValidatedBundle: jest.fn() }));
const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('../../src/config/database');
const { applyValidatedBundle } = require('../../scripts/rehearsePortfolioPromotion');
const { promoteRelease } = require('../../scripts/promotePortfolioRelease');
const bytes = Buffer.from(JSON.stringify({ accounts: [] }));
const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
const originalEnvironment = process.env.APP_ENVIRONMENT;
const originalJobs = process.env.DISABLE_BACKGROUND_JOBS;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.APP_ENVIRONMENT = 'production';
  process.env.DISABLE_BACKGROUND_JOBS = 'true';
  fs.readFileSync.mockReturnValue(bytes);
  db.query.mockResolvedValueOnce({ rows: [{ name: 'tradetally' }] })
    .mockResolvedValueOnce({ rows: [{ n: '0' }] });
  applyValidatedBundle.mockResolvedValue({ inserted: 0 });
});
afterAll(() => {
  for (const [key,value] of [['APP_ENVIRONMENT',originalEnvironment],['DISABLE_BACKGROUND_JOBS',originalJobs]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test.each([
  ['unapproved invocation', () => {}, checksum, undefined],
  ['altered bundle', () => {}, '0'.repeat(64), '--approved-production-cutover'],
  ['test environment', () => { process.env.APP_ENVIRONMENT = 'test'; }, checksum, '--approved-production-cutover'],
  ['active background jobs', () => { process.env.DISABLE_BACKGROUND_JOBS = 'false'; }, checksum, '--approved-production-cutover'],
  ['wrong database', () => { db.query.mockReset().mockResolvedValue({ rows: [{ name: 'tradetally_test' }] }); }, checksum, '--approved-production-cutover'],
  ['active sync schedules', () => { db.query.mockReset().mockResolvedValueOnce({ rows: [{ name: 'tradetally' }] }).mockResolvedValueOnce({ rows: [{ n: '1' }] }); }, checksum, '--approved-production-cutover']
])('refuses %s before any promotion writes', async (_name,setup,digest,approval) => {
  setup();
  await expect(promoteRelease('private-bundle.json',digest,approval)).rejects.toThrow();
  expect(applyValidatedBundle).not.toHaveBeenCalled();
});

test('permits the shared transaction only after all cutover gates pass', async () => {
  await expect(promoteRelease('private-bundle.json',checksum,'--approved-production-cutover')).resolves.toEqual({ inserted: 0 });
  expect(applyValidatedBundle).toHaveBeenCalledWith({ accounts: [] });
});
