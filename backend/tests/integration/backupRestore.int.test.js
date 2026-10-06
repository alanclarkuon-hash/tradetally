// Real foreign-key and transaction-lock coverage. Only run on the disposable
// TEST_DATABASE_URL database: snapshot restore intentionally clears its tables.
jest.mock('../../src/services/optionStrategyGroupingService', () => ({
  rebuildUserGroupsSafe: jest.fn().mockResolvedValue()
}));

const { randomUUID } = require('crypto');
const db = require('../../src/config/database');
const backup_service = require('../../src/services/backup.service');
const contracts = require('../../../tests/fixtures/trading-calculation-contracts.json');

describe('backup restore with real PostgreSQL', () => {
  let original_backup;
  test('streams a JSON backup above 50 MiB into PostgreSQL without holding table arrays', async () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    const { stageBackup } = require('../../src/services/backupFile.service');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-large-roundtrip-'));
    const filename = path.join(directory, 'synthetic.json');
    await db.query('CREATE TABLE backup_large_probe (id integer PRIMARY KEY, payload text NOT NULL)');
    try {
      const file = await fs.open(filename, 'w');
      try {
        await file.write('{"version":"1","tables":{"backupLargeProbe":[');
        for (let id = 0; id < 6; id++) {
          await file.write((id ? ',' : '') + JSON.stringify({ id, payload: 'x'.repeat(9 * 1024 * 1024) }));
        }
        await file.write(']}}');
      } finally { await file.close(); }
      expect((await fs.stat(filename)).size).toBeGreaterThan(50 * 1024 * 1024);
      const backup = await stageBackup(filename, directory);
      expect(Array.isArray(backup.tables.backupLargeProbe)).toBe(false);
      const result = await backup_service.restoreFromBackup(backup);
      expect(result.results.other.errors).toBe(0);
      expect(result.results.other.added).toBe(6);
      const check = await db.query('SELECT count(*)::int n, min(length(payload))::int bytes FROM backup_large_probe');
      expect(check.rows[0]).toEqual({ n: 6, bytes: 9 * 1024 * 1024 });
      // Exercise multipart disk staging as well as the PostgreSQL row reader.
      const express = require('express');
      const app = express();
      app.post('/restore', (req, res, next) => { req.user = { id: 'synthetic-admin' }; next(); }, require('../../src/middleware/backupUpload'));
      const response = await require('supertest')(app).post('/restore').attach('file', filename).expect(200);
      expect(response.body.results.other.errors).toBe(0);
      expect(response.body.results.other.skipped).toBe(6);
    } finally {
      await db.query('DROP TABLE backup_large_probe');
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 60000);
  beforeAll(async () => {
    original_backup = await backup_service.fetchAllData();
    expect(original_backup.tables.migrations).toBeUndefined();
  });
  afterAll(async () => {
    try {
      if (original_backup) {
        const result = await backup_service.restoreFromBackup(original_backup, { clearExisting: true });
        expect(result.results.other.errors).toBe(0);
        const restored = await db.query('SELECT key, value FROM instance_config ORDER BY key');
        const expected = original_backup.tables.instanceConfig.map(({ key, value }) => ({ key, value }))
          .sort((a,b) => a.key.localeCompare(b.key));
        expect(restored.rows).toEqual(expected);
      }
    } finally {
      await db.pool.end();
    }
  });

  test.each(['camel', 'snake'])('snapshot restores %s-case parents and closed option P&L in one pass', async format => {
    const migration_history = await db.query('SELECT * FROM migrations ORDER BY id');
    expect(migration_history.rows.length).toBeGreaterThan(0);
    const user_id = randomUUID();
    const broker_id = randomUUID();
    const group_id = randomUUID();
    const user = {
      id: user_id, email: `restore-${user_id}@example.com`,
      username: `restore_${user_id.slice(0, 8)}`, password_hash: 'test-only',
      timezone: 'America/Chicago'
    };
    const trades = contracts.backup_restore_cases.map(({ trade }) => ({
      ...trade, id: randomUUID(), user_id, broker_connection_id: broker_id,
      position_group_id: group_id, underlying_symbol: 'PLTR',
      option_type: 'call', strike_price: 180, expiration_date: '2026-08-29'
    }));
    // Complete fills near midnight UTC must use the newly restored timezone.
    const timezone_trade = {
      ...trades[3], id: randomUUID(), entry_time: '2026-08-06T01:00:00Z',
      executions: [{ ...trades[3].executions[0], entry_time: '2026-08-06T01:00:00Z' }]
    };
    trades.push(timezone_trade);
    const backup = { tables: {
      users: [user], trades,
      migrations: [{ id: 999999, filename: 'not-a-target-migration.sql', checksum: 'test-only' }],
      [format === 'camel' ? 'brokerConnections' : 'broker_connections']: [
        { id: broker_id, user_id, broker_type: 'schwab' }
      ],
      [format === 'camel' ? 'tradePositionGroups' : 'trade_position_groups']: [
        { id: group_id, user_id, underlying_symbol: 'PLTR' }
      ]
    } };

    const result = await backup_service.restoreFromBackup(backup, { clearExisting: true });
    expect(result.results.trades).toEqual({ added: trades.length, skipped: 0, errors: 0 });
    expect(result.results.other.errors).toBe(0);
    expect((await db.query('SELECT * FROM migrations ORDER BY id')).rows).toEqual(migration_history.rows);
    const restored = await db.query('SELECT * FROM trades WHERE user_id = $1', [user_id]);
    expect(restored.rows).toHaveLength(trades.length);
    for (const [index, fixture] of contracts.backup_restore_cases.entries()) {
      const row = restored.rows.find(trade => trade.id === trades[index].id);
      expect(Number(row.pnl)).toBeCloseTo(fixture.expected.pnl, 8);
      expect(Number(row.quantity)).toBe(fixture.expected.quantity);
      expect(row.broker_connection_id).toBe(broker_id);
      expect(row.position_group_id).toBe(group_id);
    }
    expect(restored.rows.find(trade => trade.id === timezone_trade.id).trade_date).toBe('2026-08-05');

    const repeated = await backup_service.restoreFromBackup(backup, { overwriteUsers: true });
    expect(repeated.results.trades).toEqual({ added: 0, skipped: trades.length, errors: 0 });
  });
  test('exports a consistent parent/child snapshot while another connection writes (#36)', async () => {
    await db.query('CREATE TABLE backup_export_probe_a (id INTEGER PRIMARY KEY)');
    await db.query('CREATE TABLE backup_export_probe_b (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES backup_export_probe_a(id))');
    const connect = db.connect.bind(db);
    let written = false;
    const spy = jest.spyOn(db, 'connect').mockImplementation(async () => {
      const client = await connect();
      const query = client.query.bind(client);
      client.query = async (...args) => {
        const result = await query(...args);
        if (args[0] === 'SELECT * FROM "backup_export_probe_a"' && !written) {
          written = true;
          await db.withTransaction(async writer => {
            await writer.query('INSERT INTO backup_export_probe_a VALUES (2)');
            await writer.query('INSERT INTO backup_export_probe_b VALUES (2,2)');
          });
        }
        return result;
      };
      return client;
    });
    try {
      await db.query('INSERT INTO backup_export_probe_a VALUES (1)');
      await db.query('INSERT INTO backup_export_probe_b VALUES (1,1)');
      const exported = await backup_service.fetchAllData();
      expect(written).toBe(true);
      expect(exported.tables.backupExportProbeA).toEqual([{ id: 1 }]);
      expect(exported.tables.backupExportProbeB).toEqual([{ id: 1, parent_id: 1 }]);
      expect((await db.query('SELECT * FROM backup_export_probe_b')).rows).toHaveLength(2);
    } finally {
      spy.mockRestore();
      await db.query('DROP TABLE backup_export_probe_b, backup_export_probe_a');
    }
  });  test('a newer successful backup clears the failed-attempt banner (#44)', async () => {
    const user = (await db.query('SELECT id FROM users LIMIT 1')).rows[0];
    const ids = [];
    try {
      ids.push((await db.query(`INSERT INTO backups(user_id,filename,file_path,backup_type,status,created_at)
        VALUES($1,'synthetic-banner-failure','/tmp/synthetic','manual','failed','2099-01-01') RETURNING id`, [user.id])).rows[0].id);
      expect((await backup_service.getFailureStatus()).failed).toBe(true);
      ids.push((await db.query(`INSERT INTO backups(user_id,filename,file_path,backup_type,status,created_at)
        VALUES($1,'synthetic-banner-success','/tmp/synthetic','manual','completed','2099-01-02') RETURNING id`, [user.id])).rows[0].id);
      expect(await backup_service.getFailureStatus()).toEqual({ failed: false, failedAt: null });
    } finally {
      if (ids.length) await db.query('DELETE FROM backups WHERE id=ANY($1::uuid[])', [ids]);
    }
  });});
