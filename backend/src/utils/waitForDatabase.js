// Authenticate and run a query before startup migrations. Never log connection details.
async function waitForDatabase(db, {
  timeoutMs = 120000,
  retryMs = 2000,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = console.log
} = {}) {
  const deadline = now() + timeoutMs;
  let attempts = 0;
  while (true) {
    attempts++;
    try {
      await db.pool.query({ text: 'SELECT 1', query_timeout: Math.max(1, Math.min(5000, deadline - now())) });
      log('[OK] Database accepts authenticated queries');
      return attempts;
    } catch (error) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('Database readiness timed out');
      const code = /^[A-Z0-9_]{3,20}$/.test(error.code || '') ? error.code : 'unavailable';
      log(`[WAIT] Database is not ready (${code}); retrying...`);
      await sleep(Math.min(retryMs, remaining));
    }
  }
}

if (require.main === module) {
  const db = require('../config/database');
  waitForDatabase(db)
    .catch(() => {
      console.error('[ERROR] Database readiness failed; container will retry through its restart policy.');
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { waitForDatabase };
