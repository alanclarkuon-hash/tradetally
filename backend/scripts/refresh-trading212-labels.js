// Metadata-only refresh for the isolated prototype. No financial records,
// broker sync state or valuation timestamps are changed.
const db = require('../src/config/database');
const BrokerConnection = require('../src/models/BrokerConnection');
const service = require('../src/services/brokerSync/trading212Service');
const {enrichPositions} = require('../src/services/brokerSync/trading212Instruments');

async function main() {
  if (process.env.APP_ENVIRONMENT !== 'test' || process.env.DB_NAME !== 'tradetally_test')
    throw Error('This metadata refresh is restricted to the test database');
  const apply = process.argv.includes('--apply');
  const rows = (await db.query("SELECT connection_id,positions FROM broker_portfolio_snapshots WHERE broker_type='trading212'")).rows;
  let updated = 0;
  for (const row of rows) {
    const connection = await BrokerConnection.findById(row.connection_id, true);
    if (!connection) throw Error('Trading 212 connection is unavailable');
    const positions = enrichPositions(row.positions, await service.fetchInstruments(connection));
    if (JSON.stringify(positions) === JSON.stringify(row.positions)) continue;
    if (apply) {
      const result = await db.query(`UPDATE broker_portfolio_snapshots SET positions=$1::jsonb
        WHERE broker_type='trading212' AND connection_id=$2 AND positions=$3::jsonb`,
      [JSON.stringify(positions), row.connection_id, JSON.stringify(row.positions)]);
      if (result.rowCount !== 1) throw Error('Snapshot changed during metadata refresh; retry after checking it');
    }
    updated++;
  }
  console.log(JSON.stringify({mode:apply?'applied':'preview',snapshotsWithUpdatedLabels:updated}));
}
main().catch(() => {console.error('Test instrument label refresh failed; no credentials are included in this message.');process.exitCode=1;})
  .finally(() => db.pool.end());
