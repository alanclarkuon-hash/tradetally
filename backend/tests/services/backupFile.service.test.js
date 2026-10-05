const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { stageBackup, uploadLimit } = require('../../src/services/backupFile.service');

describe('disk staged full-site JSON restore', () => {
  let directory;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-restore-test-')); });
  afterEach(async () => { delete process.env.BACKUP_MAX_FILE_SIZE; await fs.rm(directory, { recursive: true, force: true }); });
  async function stage(text) {
    const file = path.join(directory, 'input.json');
    await fs.writeFile(file, text);
    return stageBackup(file, directory);
  }
  test('preserves nested JSON values and empty tables, with repeatable row iteration', async () => {
    const rows = [{ key: 'scalar', value: 'true' }, { key: 'array', value: ['null', 42, { x: false }] }];
    const backup = await stage(JSON.stringify({ version: '1', tables: { instanceConfig: rows, users: [] } }));
    expect(backup.tables.users.length).toBe(0);
    expect(Array.isArray(backup.tables.instanceConfig)).toBe(false);
    const first = []; for await (const row of backup.tables.instanceConfig) first.push(row);
    const retry = []; for await (const row of backup.tables.instanceConfig) retry.push(row);
    expect(first).toEqual(rows); expect(retry).toEqual(rows);
  });
  test.each([
    '{"version":"1","tables":{"users":[{}]',
    '{"version":"1","tables":[]}',
    '{"version":"1","tables":{"users":{}}}',
    '{"version":"1","tables":{"users":[null]}}',
    '{"version":"1","tables":{"users":[],"users":[]}}',
    '{"version":"1","tables":{},"tables":{}}',
    '{"tables":{}}',
    '{"version":"1","tables":{}} trailing'
  ])('rejects malformed or ambiguous input before restoring: %s', async text => {
    await expect(stage(text)).rejects.toThrow();
  });
  test('honors its dedicated size cap, independent of ordinary uploads', async () => {
    process.env.BACKUP_MAX_FILE_SIZE = '20';
    expect(uploadLimit()).toBe(20);
    await expect(stage('{"version":"1","tables":{}}')).rejects.toThrow('upload limit');
    process.env.BACKUP_MAX_FILE_SIZE = '999999999999';
    expect(uploadLimit()).toBe(1024 ** 3);
  });
  test('accepts legacy pretty printing whose whitespace exceeds the compact row cap', async () => {
    const input = JSON.stringify({ version: '1', tables: { probe: [{ values: Array(500000).fill('a') }] } }, null, 10);
    expect(Buffer.byteLength(input)).toBeGreaterThan(16 * 1024 * 1024);
    const backup = await stage(input);
    for await (const row of backup.tables.probe) expect(row.values).toHaveLength(500000);
  });
});
