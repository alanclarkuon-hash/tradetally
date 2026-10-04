// Rehearsal only. Never permits production writes or copies broker credentials.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const db = require('../src/config/database');
const tables = ['asset_reference_classifications', 'portfolio_reconstruction_prices',
  'portfolio_statement_values', 'portfolio_reconstructed_values', 'portfolio_value_history', 'fx_daily_rates'];

async function promote(bundle) {
  const database = (await db.query('SELECT current_database() AS name')).rows[0].name;
  assert.equal(database, 'tradetally_rehearsal', 'Only the isolated rehearsal database is permitted');
  assert.equal(process.env.APP_ENVIRONMENT, 'test');
  return applyValidatedBundle(bundle);
}

// Shared transaction, called only after the entry point verifies its target.
async function applyValidatedBundle(bundle) {
  return db.withTransaction(async client => {
    const accounts = (await client.query('SELECT id,user_id,account_identifier,broker FROM user_accounts WHERE NOT is_archived')).rows;
    assert.equal(accounts.length, bundle.accounts.length, 'Account coverage differs');
    for (const a of bundle.accounts) assert.ok(accounts.some(b => b.id === a.id && b.user_id === a.user_id &&
      b.account_identifier === a.account_identifier && b.broker === a.broker), 'Account mapping differs');
    const counts = {};
    for (const table of tables) {
      const rows = bundle.tables[table];
      assert.ok(Array.isArray(rows));
      const result = await client.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(rows)]);
      counts[table] = result.rowCount;
    }
    // Add statement-backed lot units/details only; preserve cash and live records.
    for (const report of bundle.etoroReports) {
      const saved = (await client.query(`SELECT id,records FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='etoro' AND from_date=$3 AND to_date=$4 FOR UPDATE`,
        [report.user_id, report.account_id, report.from_date, report.to_date])).rows[0];
      assert.ok(saved, 'Matching eToro report is required');
      const references = new Map(report.records.map(r => [[r.reference,r.time,r.cash].join('|'),r]));
      let changed = false;
      const records = saved.records.map(record => {
        const source = references.get([record.reference,record.time,record.cash].join('|'));
        assert.ok(source, 'Statement cash or record identity differs');
        const next = { ...record };
        for (const key of ['units','details']) {
          if (source[key] == null) continue;
          if (next[key] == null) { next[key] = source[key]; changed = true; }
          else assert.equal(next[key],source[key], 'Existing statement annotation conflicts');
        }
        return next;
      });
      if (changed) await client.query('UPDATE broker_cash_reports SET records=$1 WHERE id=$2', [JSON.stringify(records),saved.id]);
    }
    // Daily IG statement values are supplemental, never replace the live payload.
    for (const snapshot of bundle.igStatements) {
      const saved = (await client.query(`SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='ig' AND account_identifier=$2 FOR UPDATE`,
        [snapshot.user_id,snapshot.account_identifier])).rows[0];
      assert.ok(saved?.payload?.igFileInput, 'Matching IG import is required');
      const existing = saved.payload.igFileInput.statementValues;
      if (existing != null) assert.deepEqual(existing,snapshot.values, 'Existing IG statement values conflict');
      else {
        saved.payload.igFileInput.statementValues = snapshot.values;
        await client.query(`UPDATE broker_import_snapshots SET payload=$1 WHERE user_id=$2 AND broker_type='ig' AND account_identifier=$3`,
          [JSON.stringify(saved.payload),snapshot.user_id,snapshot.account_identifier]);
      }
    }
    return counts;
  });
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file || process.argv[3] !== '--apply-rehearsal') throw Error('Provide a private bundle and --apply-rehearsal');
  promote(JSON.parse(fs.readFileSync(file,'utf8'))).then(counts => console.log(JSON.stringify({success:true,inserted:counts})))
    .catch(() => { console.error('Promotion refused or failed; private data omitted. Transaction rolled back.'); process.exitCode=1; })
    .finally(() => db.pool.end());
}
module.exports = { promote, applyValidatedBundle };
