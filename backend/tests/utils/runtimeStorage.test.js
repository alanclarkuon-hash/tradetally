const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getRuntimeDirectory, assertExternalStorage } = require('../../src/utils/runtimeStorage');
let temp;
const oldEnv = process.env;
beforeEach(() => {
  process.env = { ...oldEnv };
  for (const key of ['LOG_DIR', 'BACKUP_DIR', 'TRADETALLY_STATE_DIR']) delete process.env[key];
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tradetally-storage-test-'));
});
afterEach(() => {
  process.env = oldEnv;
  if (!temp.startsWith(path.join(os.tmpdir(), 'tradetally-storage-test-'))) throw new Error('Unsafe test cleanup');
  fs.rmSync(temp, { recursive: true, force: true });
});
test('defaults stay outside application source', () => {
  for (const kind of ['logs', 'backups']) {
    expect(path.isAbsolute(getRuntimeDirectory(kind))).toBe(true);
    expect(getRuntimeDirectory(kind).startsWith(path.resolve(__dirname, '../../..') + path.sep)).toBe(false);
  }
});
test('supports external state root and per-directory overrides', () => {
  process.env.TRADETALLY_STATE_DIR = temp;
  expect(getRuntimeDirectory('logs')).toBe(path.join(fs.realpathSync(temp), 'logs'));
  process.env.BACKUP_DIR = path.join(temp, 'separate');
  expect(getRuntimeDirectory('backups')).toBe(path.join(fs.realpathSync(temp), 'separate'));
});
test('rejects source paths and relative overrides before writes', () => {
  process.env.LOG_DIR = path.resolve(__dirname, '../../src/logs');
  expect(() => getRuntimeDirectory('logs')).toThrow('outside source');
  process.env.LOG_DIR = './logs';
  expect(() => getRuntimeDirectory('logs')).toThrow('absolute path');
});
test('rejects another checkout even for a nonexistent target', () => {
  const repo = path.join(temp, 'checkout');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, '.git'), 'gitdir: elsewhere');
  expect(() => assertExternalStorage(path.join(repo, 'private', 'logs'))).toThrow('outside source');
  expect(fs.existsSync(path.join(repo, 'private'))).toBe(false);
});
test('rejects symlinks and junctions into a checkout', () => {
  const repo = path.join(temp, 'checkout');
  fs.mkdirSync(repo);
  fs.mkdirSync(path.join(repo, '.git'));
  const link = path.join(temp, 'external-link');
  fs.symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => assertExternalStorage(path.join(link, 'logs'))).toThrow('outside source');
});
