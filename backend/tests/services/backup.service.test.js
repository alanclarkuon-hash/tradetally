jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn()
}));

jest.mock('archiver', () => jest.fn());
jest.mock('../../src/utils/siteBackupJsonWriter',()=>({writeSiteBackupJson:jest.fn()}));

jest.mock('../../src/services/analyticsCache', () => ({ invalidate: jest.fn() }));
jest.mock('../../src/services/optionStrategyGroupingService', () => ({
  rebuildUserGroupsSafe: jest.fn()
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
    writeFile: jest.fn().mockResolvedValue(),
    stat: jest.fn().mockResolvedValue({ size: 0 }),
    access: jest.fn().mockResolvedValue()
  },
  createWriteStream: jest.fn()
}));

const path = require('path');
const db = require('../../src/config/database');
const fs = require('fs').promises;
const backupService = require('../../src/services/backup.service');
const siteWriter=require('../../src/utils/siteBackupJsonWriter');
beforeEach(()=>siteWriter.writeSiteBackupJson.mockReset().mockResolvedValue({totalTables:0,totalRecords:0}));
const contracts = require('../../../tests/fixtures/trading-calculation-contracts.json');

function createRestoreClient(columnsByTable = {}, user_ids = []) {
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM information_schema.columns')) {
        const columns = columnsByTable[params[0]] || [];
        return { rows: columns.map(column => typeof column === 'string' ? { column_name: column, data_type: 'text' } : column) };
      }
      if (normalized.includes("tc.constraint_type = 'PRIMARY KEY'")) {
        return { rows: [{ column_name: 'id' }] };
      }
      if (normalized === 'SELECT id FROM users') return { rows: user_ids.map(id => ({ id })) };
      if (normalized.startsWith('SELECT timezone FROM users')) return { rows: [{ timezone: 'UTC' }] };
      if (normalized.startsWith('INSERT INTO')) return { rows: [{ id: 'restored-id' }] };
      return { rows: [] };
    })
  };
  db.connect.mockResolvedValue(client);
  return client;
}

describe('backup service hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.mkdir.mockResolvedValue();
  });

  test.each(contracts.backup_restore_cases)('restores calculation contract: $id', async ({ trade, expected }) => {
    const row = { id: 'trade-1', user_id: 'user-1', ...trade };
    const client = createRestoreClient({ trades: Object.keys(row) }, ['user-1']);
    const result = await backupService.restoreFromBackup({ tables: { trades: [row] } });

    expect(result.results.trades).toEqual({ added: 1, skipped: 0, errors: 0 });
    const [sql, values] = client.query.mock.calls.find(([query]) => String(query).startsWith('INSERT INTO "trades"'));
    const columns = sql.match(/\(([^)]+)\) VALUES/)[1].split(', ').map(column => column.replaceAll('"', ''));
    const restored = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    expect(restored).toMatchObject(expected);
    expect(db.query).not.toHaveBeenCalledWith('SELECT timezone FROM users WHERE id = $1', expect.anything());
  });

  test.each(['camel', 'snake'])('restores %s-case trade parents before their trades', async format => {
    const client = createRestoreClient({
      trades: ['id', 'user_id', 'broker_connection_id', 'position_group_id'],
      broker_connections: ['id', 'user_id'],
      trade_position_groups: ['id', 'user_id']
    }, ['user-1']);
    const result = await backupService.restoreFromBackup({ tables: {
      trades: [{ id: 'trade-1', user_id: 'user-1', broker_connection_id: 'broker-1', position_group_id: 'group-1' }],
      [format === 'camel' ? 'brokerConnections' : 'broker_connections']: [{ id: 'broker-1', user_id: 'user-1' }],
      [format === 'camel' ? 'tradePositionGroups' : 'trade_position_groups']: [{ id: 'group-1', user_id: 'user-1' }]
    } }, { clearExisting: true });

    const inserts = client.query.mock.calls.filter(([query]) => String(query).startsWith('INSERT INTO'));
    expect(inserts.map(([sql]) => sql.match(/INSERT INTO "([^"]+)"/)[1])).toEqual([
      'broker_connections', 'trade_position_groups', 'trades'
    ]);
    expect(result.results.other).toEqual({ added: 2, skipped: 0, errors: 0 });
    expect(result.results.trades.errors).toBe(0);
  });

  test('deleteOldBackups parameterizes retention and only unlinks safe backup paths', async () => {
    const safePath = path.join(backupService.backupDir, 'safe.json');

    db.query
      .mockResolvedValueOnce({
        rows: [
          { id: 'backup-1', file_path: '../../etc/passwd' },
          { id: 'backup-2', file_path: safePath }
        ]
      })
      .mockResolvedValue({ rows: [] });

    const deletedCount = await backupService.deleteOldBackups('30');

    expect(deletedCount).toBe(2);

    const [selectQuery, selectParams] = db.query.mock.calls[0];
    expect(selectQuery).toContain("WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')");
    expect(selectParams).toEqual([30]);

    expect(fs.unlink).toHaveBeenCalledTimes(1);
    expect(fs.unlink).toHaveBeenCalledWith(safePath);
    expect(db.query).toHaveBeenCalledWith('DELETE FROM backups WHERE id = $1', ['backup-1']);
    expect(db.query).toHaveBeenCalledWith('DELETE FROM backups WHERE id = $1', ['backup-2']);
  });

  test('deleteOldBackups rejects invalid retention values', async () => {
    await expect(backupService.deleteOldBackups('0')).rejects.toThrow(
      'Retention days must be an integer between 1 and 365'
    );
    expect(db.query).not.toHaveBeenCalled();
  });

  test('createFullSiteBackup ensures backup directory before writing file', async () => {
    createRestoreClient();
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'backup-1',
          filename: 'backup.json',
          file_path: path.join(backupService.backupDir, 'backup.json'),
          status: 'completed'
        }]
      });

    await backupService.createFullSiteBackup('user-1', 'manual');

    expect(fs.mkdir).toHaveBeenCalledWith(backupService.backupDir, { recursive: true });
    expect(siteWriter.writeSiteBackupJson).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.mkdir.mock.invocationCallOrder[0]).toBeLessThan(siteWriter.writeSiteBackupJson.mock.invocationCallOrder[0]);
  });

  test('ignores a malicious backup table key before constructing SQL', async () => {
    const client = createRestoreClient();

    await backupService.restoreFromBackup({
      tables: { 'evil); DROP TABLE users;--': [{ id: 'row-1' }] },
      tableNameMapping: {}
    });

    const sql = client.query.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('evil)');
  });

  test('rejects a malicious table-name mapping before metadata or inserts', async () => {
    const client = createRestoreClient();

    await backupService.restoreFromBackup({
      tables: { activityEvents: [{ id: 'row-1' }] },
      tableNameMapping: { activityEvents: 'users; DROP TABLE users;--' }
    });

    const sql = client.query.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('INSERT INTO');
  });

  test('skips a backup table that does not exist in the target schema', async () => {
    const client = createRestoreClient();

    await backupService.restoreFromBackup({
      tables: { unknownTable: [{ id: 'row-1' }] },
      tableNameMapping: { unknownTable: 'unknown_table' }
    });

    expect(client.query.mock.calls.some(([query]) => String(query).startsWith('INSERT INTO'))).toBe(false);
  });

  test('skips a row with no recognized target columns', async () => {
    const client = createRestoreClient({ custom_table: ['id'] });

    const result = await backupService.restoreFromBackup({
      tables: { customTable: [{ unexpected: 'value' }] },
      tableNameMapping: { customTable: 'custom_table' }
    });

    expect(result.tableResults.custom_table.skipped).toBe(1);
    expect(client.query.mock.calls.some(([query]) => String(query).startsWith('INSERT INTO'))).toBe(false);
  });

  test('quotes validated table and column identifiers during a valid restore', async () => {
    const client = createRestoreClient({ custom_table: ['id', 'label'] });

    await backupService.restoreFromBackup({
      tables: { customTable: [{ id: 'row-1', label: 'Safe' }] },
      tableNameMapping: { customTable: 'custom_table' }
    });

    const insert = client.query.mock.calls.find(([query]) => String(query).startsWith('INSERT INTO'));
    expect(insert[0]).toContain('INSERT INTO "custom_table" ("id", "label")');
    expect(insert[0]).toContain('RETURNING "id"');
  });
});

describe('full-site export snapshot and failure handling (#36)', () => {
  function exportClient(failTable = null) {
    const client = {
      release: jest.fn(),
      query: jest.fn(async sql => {
        if (sql.includes('information_schema.tables')) return { rows: [
          { table_name: 'users' }, { table_name: 'trades' },
          { table_name: 'broker_connections' }, { table_name: 'backups' }
        ] };
        if (sql === `SELECT * FROM "${failTable}"`) throw Error('private-value-from-query');
        if (sql === 'SELECT * FROM "users"') return { rows: [{ id: 'synthetic-user' }] };
        return { rows: [] };
      })
    };
    db.connect.mockResolvedValue(client);
    return client;
  }
  beforeEach(() => {
    jest.resetAllMocks();
    fs.mkdir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    fs.stat.mockResolvedValue({ size: 10 });
    db.query.mockResolvedValue({ rows: [] });
  });
  test('exports real empty tables and related records from one read-only snapshot', async () => {
    const client = exportClient();
    const result = await backupService.fetchAllData();
    expect(result.tables).toEqual({ users: [{ id: 'synthetic-user' }], trades: [], brokerConnections: [] });
    expect(result.tableNameMapping.brokerConnections).toBe('broker_connections');
    expect(result.statistics).toMatchObject({ totalTables: 3, totalRecords: 1, trades: 0 });
    expect(client.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('SELECT * FROM "backups"');
    expect(db.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  test('rejects a failed table read, rolls back and releases without returning partial records', async () => {
    const client = exportClient('trades');
    await expect(backupService.fetchAllData()).rejects.toThrow('Backup export failed while reading table "trades"');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('SELECT * FROM "broker_connections"');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  test('never writes a file or marks a failed export completed', async () => {
    siteWriter.writeSiteBackupJson.mockRejectedValueOnce(Error('Backup export failed while reading table "trades". No complete backup was created.'));
    await expect(backupService.createFullSiteBackup('synthetic-user')).rejects.toThrow('Backup export failed');
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.stat).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
    const parameters = db.query.mock.calls[0][1];
    expect(parameters[4]).toBe('failed');
    expect(parameters[5]).toContain('table "trades"');
    expect(parameters[5]).not.toContain('private-value');
  });
  test('marks completed only after the whole snapshot is committed and the file is saved', async () => {
    db.query.mockResolvedValue({ rows: [{ status: 'completed' }] });
    const result = await backupService.createFullSiteBackup('synthetic-user');
    expect(result.success).toBe(true);
    expect(siteWriter.writeSiteBackupJson.mock.invocationCallOrder[0]).toBeLessThan(fs.stat.mock.invocationCallOrder[0]);
    expect(fs.stat.mock.invocationCallOrder[0]).toBeLessThan(db.query.mock.invocationCallOrder[0]);
    expect(db.query.mock.calls[0][1][5]).toBe('completed');
  });
  test('rejects discovery errors with a sanitized message', async () => {
    const client = exportClient();
    client.query.mockRejectedValueOnce(Error('private metadata'));
    await expect(backupService.fetchAllData()).rejects.toThrow('Backup export failed. No complete backup was created.');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  test('still releases the connection when rollback fails', async () => {
    const client = exportClient('trades');
    const original = client.query.getMockImplementation();
    client.query.mockImplementation(sql => sql === 'ROLLBACK' ? Promise.reject(Error('rollback failed')) : original(sql));
    await expect(backupService.fetchAllData()).rejects.toThrow('table "trades"');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  test('sanitizes connection failures and never writes a file', async () => {
    siteWriter.writeSiteBackupJson.mockRejectedValueOnce(Error('Backup export failed. No complete backup was created.'));
    await expect(backupService.createFullSiteBackup('synthetic-user')).rejects.toThrow('Backup export failed.');
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(db.query.mock.calls[0][1][4]).toBe('failed');
  });
});
describe('restoring native JSON values (#41)', () => {
  beforeEach(() => jest.resetAllMocks());
  test.each(['json', 'jsonb'])('preserves native %s scalar types, objects and arrays', async type => {
    const values = ['plain text', 'true', '42', 'null', '{"key":"value"}', '"quoted"', true, 42, { key: 'value' }, ['a', 'b']];
    const client = createRestoreClient({ custom_table: ['id', { column_name: 'value', data_type: type }] });
    const result = await backupService.restoreFromBackup({ version: '3.0', tables: {
      customTable: values.map((value, index) => ({ id: `synthetic-${index}`, value }))
    } });
    expect(result.tableResults.custom_table.errors).toBe(0);
    const restored = client.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO "custom_table"'))
      .map(([,params]) => JSON.parse(params[1]));
    expect(restored).toEqual(values);
  });
});
describe('backup failure banner status (#44)', () => {
  beforeEach(() => jest.resetAllMocks());
  test('returns only sanitized failure state and timestamp', async () => {
    db.query.mockResolvedValue({ rows: [{ status: 'failed', created_at: '2026-01-01T12:00:00Z', file_path: '/private/file', error_message: 'private error' }] });
    await expect(backupService.getFailureStatus()).resolves.toEqual({ failed: true, failedAt: '2026-01-01T12:00:00Z' });
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain("WHERE status IN ('failed', 'completed')");
    expect(sql).toContain('ORDER BY created_at DESC');
  });
  test.each([{ rows: [] }, { rows: [{ status: 'completed', created_at: '2026-01-02T12:00:00Z' }] }])('hides the banner for no history or a successful latest attempt', async ({ rows }) => {
    db.query.mockResolvedValue({ rows });
    await expect(backupService.getFailureStatus()).resolves.toEqual({ failed: false, failedAt: null });
  });
});
