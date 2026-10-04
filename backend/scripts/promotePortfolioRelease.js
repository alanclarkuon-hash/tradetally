// Operator-run cutover only. Creating this file does not authorize deployment.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const db = require('../src/config/database');
const { applyValidatedBundle } = require('./rehearsePortfolioPromotion');

async function promoteRelease(file, expectedDigest, approved) {
  assert.equal(approved, '--approved-production-cutover', 'Explicit cutover confirmation required');
  assert.match(expectedDigest || '', /^[a-f0-9]{64}$/, 'Reviewed bundle SHA-256 required');
  const buffer = fs.readFileSync(file);
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), expectedDigest, 'Bundle checksum differs');
  assert.notEqual(process.env.APP_ENVIRONMENT, 'test', 'Test environment is not production');
  assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true', 'Background jobs must be disabled for cutover');
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, 'tradetally', 'Unexpected production database');
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM broker_connections WHERE auto_sync_enabled')).rows[0].n), 0,
    'Broker automatic syncs must be paused before cutover');
  return applyValidatedBundle(JSON.parse(buffer));
}

if (require.main === module) {
  promoteRelease(process.argv[2],process.argv[3],process.argv[4])
    .then(inserted => console.log(JSON.stringify({success:true,inserted})))
    .catch(() => { console.error('Cutover refused or failed; private data omitted.'); process.exitCode=1; })
    .finally(() => db.pool.end());
}
module.exports = { promoteRelease };
