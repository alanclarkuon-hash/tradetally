// Rebuild using a previously downloaded private history snapshot. Dry-run
// unless --apply is supplied; apply backs up the database first.
const fs = require('fs/promises');
const db = require('../src/config/database');
const BrokerConnection = require('../src/models/BrokerConnection');
const service = require('../src/services/brokerSync/trading212Service');
const { reconcileSnapshot } = require('../src/services/brokerSync/trading212Reconcile');

async function main() {
  const connections = (await db.query("SELECT id FROM broker_connections WHERE broker_type='trading212'")).rows;
  if (connections.length !== 1) throw new Error('Repair requires exactly one Trading 212 connection');
  const running = (await db.query("SELECT count(*) AS n FROM broker_sync_logs WHERE status IN ('started','fetching','parsing','importing')")).rows[0].n;
  if (Number(running)) throw new Error('A broker sync is running');
  const connection = await BrokerConnection.findById(connections[0].id);
  const raw = JSON.parse(await fs.readFile('/app/backend/src/data/trading212-repair-history.json', 'utf8'));
  const trades = service.mapExecutionsToTrades(raw);
  const apply = process.argv.includes('--apply');
  console.log(JSON.stringify(await reconcileSnapshot(connection, raw, trades, { dryRun: !apply, backup: apply })));
}

main().catch(e => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => { await db.pool.end(); process.exit(process.exitCode || 0); });
