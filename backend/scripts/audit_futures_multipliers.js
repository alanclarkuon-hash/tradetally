// Production-safe, read-only candidate report. A mismatch is a review flag,
// not proof: manual multipliers and broker quote units can be intentional.
const fs = require('fs');
const { maintenancePaths, writePrivateReport } = require('../src/utils/maintenanceReport');
const { Client } = require('pg');
const { resolveFuturesRoot, extractUnderlyingFromFuturesSymbol, getFuturesPointValue } = require('../src/utils/futuresUtils');

async function main() {
  const {envFile, report} = maintenancePaths(process.argv.slice(2));
  const env = require('dotenv').parse(fs.readFileSync(envFile));
  const client = new Client({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
    options: '-c default_transaction_read_only=on -c statement_timeout=20000' });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const rows = (await client.query(`SELECT symbol,underlying_asset,point_value,broker,original_currency,
      count(*)::int AS trades,array_agg(DISTINCT user_id) AS user_ids
      FROM trades WHERE instrument_type='future' GROUP BY 1,2,3,4,5`)).rows;
    const groups = new Map();
    const unresolved = new Map();
    for (const row of rows) {
      const root = resolveFuturesRoot(row.symbol) || resolveFuturesRoot(row.underlying_asset);
      if (!root) {
        const name = extractUnderlyingFromFuturesSymbol(row.symbol) || row.symbol;
        unresolved.set(name, (unresolved.get(name) || 0) + row.trades);
        continue;
      }
      const expected = getFuturesPointValue(root);
      if (Number(row.point_value) === expected) continue;
      const key = `${root}:${row.point_value}:${row.original_currency || 'USD'}`;
      const group = groups.get(key) || { root, storedPointValue: row.point_value == null ? null : Number(row.point_value), exchangePointValue: expected,
        currency: row.original_currency || 'USD', trades: 0, users: new Set(), brokers: new Set() };
      group.trades += row.trades;
      row.user_ids.forEach(id => group.users.add(id));
      group.brokers.add(row.broker);
      groups.set(key, group);
    }
    const candidates = [...groups.values()].sort((a, b) => b.trades - a.trades)
      .map(group => ({ ...group, users: group.users.size, brokers: [...group.brokers] }));
    writePrivateReport(report, { readOnly: true, note: 'Review candidates; broker quote units and manual overrides require confirmation.',
      mismatchedTrades: candidates.reduce((sum, group) => sum + group.trades, 0), candidates,
      unresolvedContracts: [...unresolved].map(([symbol, trades]) => ({ symbol, trades })) });
    console.log(JSON.stringify({readOnly:true, candidateGroups:candidates.length}));
    await client.query('ROLLBACK');
  } finally { await client.end(); }
}
if (require.main === module) main().catch(error => { console.error('Futures audit failed; no records were changed.'); process.exitCode = 1; });
