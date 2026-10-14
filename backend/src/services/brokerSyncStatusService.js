const db = require('../config/database');

// Return only fixed summaries; raw broker errors may contain credentials or records.
function failureSummary(message, fallback = 'Sync failed. Review the connection on Broker Sync.') {
  const text = String(message || '').toLowerCase();
  if (/interrupt|restart/.test(text)) return 'Sync was interrupted. Retry it to finish collecting activity.';
  if (/rate.limit|too many|429/.test(text)) return 'Broker rate limit reached. Retry after the cooldown.';
  if (/reconcil|balance|coverage/.test(text)) return 'Balance or history reconciliation needs review.';
  if (/unauthor|credential|token|permission|401|403/.test(text)) return 'Connection authorization or permissions need review.';
  if (/timeout|network|unavailable|connection/.test(text)) return 'The broker could not be reached. Retry later.';
  return fallback;
}
function warningSummary(messages) {
  const summaries = new Set();
  for(const value of Array.isArray(messages) ? messages : []) {
    const text = String(value).toLowerCase();
    if(/statement|less than one year/.test(text)) summaries.add('Older broker activity may require an account statement.');
    if(/tax basis|acquisition cost/.test(text)) summaries.add('Original acquisition costs for incoming transfers need review.');
    if(/estimat|price.*unavailable/.test(text)) summaries.add('Some historical values use estimates or unavailable prices.');
    if(/reconcil/.test(text)) summaries.add('Balance or history reconciliation needs review.');
  }
  return [...summaries].join(' ') || 'Sync completed with warnings. Review Broker Sync.';
}
const active = new Set(['started','fetching','parsing','importing','processing','pending']);
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
async function getStatus(userId) {
  const connections = (await db.query(`
    SELECT bc.id, bc.broker_type, bc.account_label, bc.connection_status,
      bc.last_sync_at, bc.last_sync_status,
      bc.last_error_at, bc.last_error_message,
      latest.status, latest.started_at, latest.completed_at, latest.outcome, latest.warnings,
      failed.completed_at AS failed_at, failed.error_message
    FROM broker_connections bc
    LEFT JOIN LATERAL (SELECT status, started_at, completed_at, sync_details->>'outcome' AS outcome, sync_details->'warnings' AS warnings FROM broker_sync_logs
      WHERE connection_id=bc.id AND user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1) latest ON true
    LEFT JOIN LATERAL (SELECT completed_at, error_message FROM broker_sync_logs
      WHERE connection_id=bc.id AND user_id=$1 AND status='failed'
      ORDER BY created_at DESC, id DESC LIMIT 1) failed ON true
    WHERE bc.user_id=$1 ORDER BY bc.broker_type, bc.account_label, bc.id`, [userId])).rows;
  const manual = (await db.query(`SELECT DISTINCT broker FROM user_accounts
    WHERE user_id=$1 AND is_archived=false AND broker IS NOT NULL`, [userId])).rows;
  return [
    ...connections.map(row => {
      const running = active.has(row.status) && !row.completed_at;
      const status = running ? 'running' : row.connection_status === 'expired' ? 'reconnect' :
        row.connection_status === 'error' ? 'failed' :
        row.last_sync_status === 'failed' ? 'failed' :
        row.status === 'completed' && row.outcome === 'warning' ? 'warning' :
        ['success','warning'].includes(row.last_sync_status) ? row.last_sync_status :
        row.status === 'completed' ? (row.outcome === 'warning' ? 'warning' : 'success') : row.status === 'failed' ? 'failed' : 'never';
      const failureAt = time(row.last_error_at) > time(row.failed_at) ? row.last_error_at : row.failed_at;
      const failure = time(row.last_error_at) > time(row.failed_at) ? row.last_error_message : row.error_message;
      return {id:row.id, broker:row.broker_type, accountLabel:row.account_label || null,
        lastSuccessfulSyncAt:row.last_sync_at || null, status,
        lastAttemptAt:row.completed_at || row.started_at || null,
        lastFailureAt:failureAt || null,
        failure:failureAt ? failureSummary(failure) : null,
        warning:status==='warning' ? warningSummary(row.warnings) : null};
    }),
    ...manual.filter(row => !connections.some(c => c.broker_type === row.broker))
      .map(row => ({id:`manual:${row.broker}`,broker:row.broker,status:'manual'}))
  ];
}
module.exports = {getStatus, failureSummary};
