const db = require('../config/database');

// Summarize failures without returning raw broker responses, credentials or account identifiers.
function failureSummary(message) {
  const text = String(message || '').toLowerCase();
  if (/rate.limit|too many|429/.test(text)) return 'Broker rate limit reached. Retry after the cooldown.';
  if (/reconcil|balance|coverage/.test(text)) return 'Balance or history reconciliation needs review.';
  if (/unauthor|credential|token|permission|401|403/.test(text)) return 'Connection authorization or permissions need review.';
  if (/timeout|network|unavailable|connection/.test(text)) return 'The broker could not be reached. Retry later.';
  return 'Sync failed. Review the connection on Broker Sync.';
}

async function getStatus(userId) {
  const connections = (await db.query(`
    SELECT bc.id, bc.broker_type, bc.last_sync_at, bc.last_sync_status,
      latest.status, latest.started_at, latest.completed_at,
      failed.completed_at AS failed_at, failed.error_message
    FROM broker_connections bc
    LEFT JOIN LATERAL (SELECT status, started_at, completed_at FROM broker_sync_logs
      WHERE connection_id=bc.id AND user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1) latest ON true
    LEFT JOIN LATERAL (SELECT completed_at, error_message FROM broker_sync_logs
      WHERE connection_id=bc.id AND user_id=$1 AND status='failed'
      ORDER BY created_at DESC, id DESC LIMIT 1) failed ON true
    WHERE bc.user_id=$1 ORDER BY bc.broker_type, bc.id`, [userId])).rows;
  const manual = (await db.query(`SELECT DISTINCT broker FROM user_accounts
    WHERE user_id=$1 AND broker IS NOT NULL`, [userId])).rows;
  return [
    ...connections.map(row => ({id: row.id, broker: row.broker_type,
      lastSuccessfulSyncAt: row.last_sync_at,
      status: ['started','processing','pending'].includes(row.status) ? 'running' : row.last_sync_status || row.status || 'never',
      lastAttemptAt: row.completed_at || row.started_at || null,
      lastFailureAt: row.failed_at || null,
      failure: row.failed_at ? failureSummary(row.error_message) : null})),
    ...manual.filter(row => !connections.some(c => c.broker_type === row.broker))
      .map(row => ({id: `manual:${row.broker}`, broker: row.broker, status: 'manual'}))
  ];
}
module.exports = {getStatus, failureSummary};
