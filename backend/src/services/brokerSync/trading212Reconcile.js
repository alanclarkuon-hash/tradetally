const db = require('../../config/database');
const { computeTradePnl } = require('../pnlEngine');
const AnalyticsCache = require('../analyticsCache');

function executions(row) {
  const value = row.executionData || row.executions || [];
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function identity(row) {
  return `${row.symbol}|${row.side}|${executions(row).map(e =>
    `${e.type}:${e.order_id ?? e.orderId}`).join('|')}`;
}

function entryIdentity(row) {
  const entry = executions(row).find(e => e.type === 'entry');
  return `${row.symbol}|${row.side}|${entry?.order_id ?? entry?.orderId}`;
}

// Reserve exact matches before assigning a former open lot to its first
// closing slice. Preserve existing IDs, notes and attached user content.
function planSnapshot(desired, existing) {
  const byIdentity = new Map();
  for (const row of existing) {
    const key = identity(row);
    if (byIdentity.has(key)) throw new Error('Ambiguous existing Trading 212 execution identity');
    byIdentity.set(key, row);
  }
  const used = new Set();
  const plans = desired.map(trade => {
    const old = byIdentity.get(identity(trade));
    if (old) used.add(old.id);
    return { trade, old };
  });
  for (const plan of plans) {
    if (plan.old) continue;
    const old = existing.find(row => !used.has(row.id) && !row.exit_time &&
      entryIdentity(row) === entryIdentity(plan.trade));
    if (old) { plan.old = old; used.add(old.id); }
  }
  // A shortened history or edited execution must never silently remove data.
  if (existing.some(row => !used.has(row.id))) {
    throw new Error('Trading 212 snapshot does not cover existing trades; import complete history before reconciling');
  }
  return plans;
}

function validateCoverage(raw, trades) {
  const expected = new Map();
  for (const item of raw) {
    if (item.fill.type && item.fill.type !== 'TRADE') continue;
    const id = String(item.fill.id);
    if (expected.has(id)) throw new Error('Duplicate Trading 212 fill in history');
    expected.set(id, Math.abs(Number(item.fill.quantity)));
  }
  const actual = new Map();
  for (const trade of trades) for (const e of executions(trade)) {
    const id = String(e.order_id ?? e.orderId);
    actual.set(id, (actual.get(id) || 0) + Number(e.quantity));
  }
  if (expected.size !== actual.size || [...expected].some(([id, qty]) =>
    Math.abs(qty - (actual.get(id) || 0)) > 0.000001)) {
    throw new Error('Trading 212 fill allocation failed quantity conservation');
  }
}

async function reconcileSnapshot(connection, raw, trades, { dryRun = false, backup = false } = {}) {
  validateCoverage(raw, trades);
  const accounts = [...new Set(trades.map(t => t.accountIdentifier).filter(Boolean))];
  if (accounts.length > 1) throw new Error('Trading 212 snapshot contains multiple accounts');
  const account = accounts[0] || null;
  const user = (await db.query('SELECT timezone FROM users WHERE id=$1', [connection.userId])).rows[0];
  // Removing a connection leaves its trades with a NULL connection ID. Adopt
  // only the same owner's account, after planSnapshot verifies exact fills.
  if (!account && Number((await db.query(`SELECT count(*) AS n FROM trades
    WHERE user_id=$1 AND broker='trading212' AND broker_connection_id IS NULL`,
  [connection.userId])).rows[0].n)) {
    throw new Error('Cannot identify the Trading 212 account for retained trades');
  }
  const existing = (await db.query(`SELECT * FROM trades WHERE user_id=$1
    AND broker='trading212' AND (broker_connection_id=$2
      OR (broker_connection_id IS NULL AND account_identifier=$3))`,
  [connection.userId, connection.id, account])).rows;
  const plans = planSnapshot(trades, existing);
  const result = { imported: plans.filter(p => !p.old).length, updated: existing.length,
    duplicates: 0, skipped: 0, failed: 0, fills: raw.length, trades: trades.length };
  if (dryRun) return result;
  if (backup) await require('../backup.service').createFullSiteBackup(connection.userId, 'manual');
  await db.withTransaction(async client => {
    // Broker sync service already serialises a connection. This also guards
    // direct repair runs against concurrent reconciliations.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [connection.id]);
    const fresh = (await client.query(`SELECT * FROM trades WHERE user_id=$1
      AND broker='trading212' AND (broker_connection_id=$2
        OR (broker_connection_id IS NULL AND account_identifier=$3)) FOR UPDATE`,
    [connection.userId, connection.id, account])).rows;
    if (fresh.length !== existing.length || fresh.some(row => {
      const old = existing.find(r => r.id === row.id);
      return !old || row.updated_at.getTime() !== old.updated_at.getTime();
    })) throw new Error('Trades changed during reconciliation; retry sync');
    for (const { trade: t, old } of plans) {
      const computed = computeTradePnl({ side: t.side, instrumentType: t.instrumentType,
        executions: t.executionData, timezone: user.timezone });
      const a = computed.aggregate;
      const risk = old?.stop_loss == null ? 0 : Math.abs(a.entry_price - Number(old.stop_loss)) * a.quantity;
      const values = [connection.userId, t.symbol, a.trade_date, a.entry_time, a.exit_time,
        a.entry_price, a.exit_price, a.quantity, t.side, a.commission, a.fees, a.pnl,
        a.pnl_percent, JSON.stringify(computed.annotatedExecutions), t.originalCurrency,
        connection.id, t.accountIdentifier, risk > 0 && a.pnl != null ? a.pnl / risk : null];
      if (old) {
        await client.query(`UPDATE trades SET symbol=$2,trade_date=$3,entry_time=$4,exit_time=$5,
          entry_price=$6,exit_price=$7,quantity=$8,side=$9,commission=$10,fees=$11,pnl=$12,
          pnl_percent=$13,executions=$14::jsonb,original_currency=$15,exchange_rate=1,
          account_identifier=$17,broker_connection_id=$16,r_value=$18,updated_at=NOW()
          WHERE user_id=$1 AND (broker_connection_id=$16 OR broker_connection_id IS NULL) AND id=$19`, [...values, old.id]);
      } else {
        await client.query(`INSERT INTO trades(user_id,symbol,trade_date,entry_time,exit_time,
          entry_price,exit_price,quantity,side,commission,fees,pnl,pnl_percent,executions,
          original_currency,broker_connection_id,account_identifier,r_value,broker,instrument_type,exchange_rate)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,'trading212','stock',1)`, values);
      }
    }
    await client.query('DELETE FROM analytics_cache WHERE user_id=$1', [connection.userId]);
  });
  await AnalyticsCache.invalidate(connection.userId);
  return result;
}

module.exports = { reconcileSnapshot, planSnapshot, validateCoverage };
