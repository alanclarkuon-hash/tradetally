const db = require('../../config/database');
const AnalyticsCache = require('../analyticsCache');

function field(object, name) {
  const key = Object.keys(object || {}).find(k => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : object[key];
}
function number(value, name, positive = false) {
  if (value == null || !Number.isFinite(Number(value)) || (positive && Number(value) <= 0)) {
    throw new Error(`Incomplete eToro ${name}. Import stopped without changing reports.`);
  }
  return Number(value);
}
function timestamp(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error('Invalid eToro trade timestamp.');
  return date.toISOString();
}
function getExecutions(row) {
  return typeof row.executions === 'string' ? JSON.parse(row.executions) : row.executions || [];
}
function identity(row) { return getExecutions(row)[0]?.etoro_record_key; }
function positionId(row) { return String(getExecutions(row)[0]?.etoro_position_id); }

function cashSnapshot(portfolio, accountIdentifier) {
  const raw = field(portfolio, 'credit');
  if (raw === '' || typeof raw === 'boolean') throw new Error('Invalid eToro cash balance.');
  // Credit is the USD cash balance before reserving pending orders. Bonus
  // credit, invested positions and the separate Money account are excluded.
  return { amount: number(raw, 'cash balance'), currency: 'USD', accountIdentifier,
    asOf: new Date().toISOString() };
}

function mapSnapshot(payload) {
  const instruments = new Map(payload.instruments.map(i => [String(field(i, 'instrumentId')), i]));
  const types = new Map(payload.instrumentTypes.map(t => [String(field(t, 'instrumentTypeId')), field(t, 'instrumentTypeDescription')]));
  const instrument = id => {
    const item = instruments.get(String(id));
    const description = String(types.get(String(field(item, 'instrumentTypeId'))) || '').toLowerCase();
    const type = description.includes('crypto') ? 'crypto' : ['stocks', 'stock', 'etf'].includes(description) ? 'stock' : null;
    const symbol = field(item, 'symbolFull');
    if (!type || typeof symbol !== 'string' || !symbol.trim()) throw new Error('Unsupported or unidentified eToro instrument. Import stopped for review.');
    return { symbol: symbol.trim().toUpperCase(), instrumentType: type };
  };
  const trades = [];
  const positions = [];
  const keys = new Set();
  const add = trade => {
    if (keys.has(trade.key)) throw new Error('Duplicate eToro record identity.');
    keys.add(trade.key); trades.push(trade);
  };
  for (const row of payload.positions) {
    if (Number(field(row, 'leverage')) !== 1 || field(row, 'isBuy') !== true) {
      throw new Error('Leveraged or short eToro positions need a separate import review.');
    }
    const id = field(row, 'positionId');
    const asset = instrument(field(row, 'instrumentId'));
    const quantity = number(field(row, 'units'), 'open units', true);
    const rawPrice = number(field(row, 'openRate'), 'opening price', true);
    const fx = number(field(row, 'openConversionRate'), 'opening conversion rate', true);
    const cost = number(field(row, 'unitsBaseValueDollars'), 'remaining USD cost', true);
    if (Math.abs(rawPrice * fx * quantity - cost) > 0.05) throw new Error('eToro remaining units and USD cost do not reconcile.');
    const pnl = field(row, 'unrealizedPnL');
    const currentPrice = number(field(pnl, 'closeRate'), 'current price', true) *
      number(field(pnl, 'closeConversionRate'), 'current conversion rate', true);
    const entryTime = timestamp(field(row, 'openDateTime'));
    const key = `open:${id}`;
    const execution = { type: 'entry', action: 'buy', quantity, price: cost / quantity,
      datetime: entryTime, order_id: String(field(row, 'orderId')), etoro_record_key: key,
      etoro_position_id: String(id), etoro_native_price: rawPrice, etoro_open_conversion_rate: fx,
      etoro_mirror_id: field(row, 'mirrorId') || null,
      etoro_parent_position_id: field(row, 'parentPositionId') || null };
    add({ ...asset, key, positionId: String(id), side: 'long', quantity,
      entryTime, exitTime: null, entryPrice: cost / quantity, exitPrice: null,
      pnl: null, fees: 0, executions: [execution] });
    positions.push({ symbol: asset.symbol, instrumentType: asset.instrumentType,
      quantity, totalCost: cost, currentValue: currentPrice * quantity,
      openedAt: entryTime, positionId: String(id), currency: 'USD' });
  }
  for (const row of payload.history) {
    if (Number(row.leverage) !== 1 || typeof row.isBuy !== 'boolean') throw new Error('Leveraged eToro history needs a separate import review.');
    const asset = instrument(row.instrumentId);
    const quantity = number(row.units, 'closed units', true);
    const entryPrice = number(row.openRate, 'closed opening price', true);
    const exitPrice = number(row.closeRate, 'closing price', true);
    const investment = number(row.investment, 'closed investment', true);
    // The history API supplies no FX rate. Only import records whose USD
    // investment independently confirms that their quoted prices are USD.
    if (Math.abs(investment - entryPrice * quantity) > 0.05) throw new Error('eToro historical currency conversion needs review.');
    const netProfit = number(row.netProfit, 'reported net profit');
    const fees = number(row.fees, 'reported fees');
    const gross = (exitPrice - entryPrice) * quantity * (row.isBuy ? 1 : -1);
    // Broker fees can be informational (notably crypto) or already included.
    // Accept the verified formats, always stamp the broker's authoritative net.
    if (Math.abs(gross - fees - netProfit) > 0.05 && Math.abs(gross - netProfit) > 0.05) {
      throw new Error('eToro reported profit needs review.');
    }
    const entryTime = timestamp(row.openTimestamp);
    const exitTime = timestamp(row.closeTimestamp);
    if (exitTime < entryTime || row.positionId == null || row.orderId == null) throw new Error('Invalid eToro closing identity or date.');
    const key = `closed:${row.positionId}:${row.orderId}:${exitTime}:${quantity}`;
    const common = { etoro_record_key: key, etoro_position_id: String(row.positionId),
      etoro_social_trade_id: row.socialTradeId || null, etoro_parent_position_id: row.parentPositionId || null };
    add({ ...asset, key, positionId: String(row.positionId), side: row.isBuy ? 'long' : 'short',
      quantity, entryTime, exitTime, entryPrice, exitPrice, pnl: netProfit, fees,
      executions: [
        { ...common, type: 'entry', action: row.isBuy ? 'buy' : 'sell', quantity, price: entryPrice, datetime: entryTime },
        { ...common, type: 'exit', action: row.isBuy ? 'sell' : 'buy', quantity, price: exitPrice,
          datetime: exitTime, order_id: String(row.orderId), fees,
          realized_pnl: netProfit, gross_realized_pnl: gross, exit_date: exitTime.slice(0, 10),
          etoro_reported_net_profit: netProfit }
      ] });
  }
  const grouped = new Map();
  for (const p of positions) {
    const old = grouped.get(p.symbol);
    if (old) {
      if (old.instrumentType !== p.instrumentType) throw new Error('Conflicting eToro instrument classifications.');
      old.quantity += p.quantity;
      old.totalCost += p.totalCost;
      old.currentValue += p.currentValue;
      old.lotCount++;
      old.openedAt = old.openedAt < p.openedAt ? old.openedAt : p.openedAt;
    } else grouped.set(p.symbol, { ...p, lotCount: 1 });
  }
  return { trades, positions: [...grouped.values()] };
}

function plan(desired, existing) {
  const byKey = new Map();
  for (const row of existing) {
    const key = identity(row);
    if (!key || byKey.has(key)) throw new Error('Existing eToro trades need an identity review.');
    byKey.set(key, row);
  }
  const used = new Set();
  const plans = desired.map(trade => {
    const old = byKey.get(trade.key);
    if (old) used.add(old.id);
    return { trade, old };
  });
  // Reserve remaining open lots first. A full closure can reuse its former
  // open trade ID; a partial sale alongside a remaining lot gets a separate ID.
  for (const item of plans) {
    if (item.old || !item.trade.exitTime) continue;
    // Statements round timestamps to seconds. Match their broker position
    // identity plus times, units and profit when it enters the API window.
    const statements = existing.filter(r => !used.has(r.id) && r.exit_time &&
      positionId(r) === item.trade.positionId &&
      getExecutions(r)[0]?.etoro_statement_source &&
      require('./etoroStatement').matches(r, item.trade));
    if (statements.length > 1) throw new Error('Ambiguous eToro statement overlap.');
    if (statements.length === 1) { item.old = statements[0]; used.add(item.old.id); continue; }
    const old = existing.find(r => !r.exit_time && !used.has(r.id) && positionId(r) === item.trade.positionId);
    if (old) { item.old = old; used.add(old.id); }
  }
  if (existing.some(r => !r.exit_time && !used.has(r.id))) {
    throw new Error('An existing eToro open lot disappeared without a closing record. Import stopped for review.');
  }
  return plans;
}

async function reconcile(connection, payload, { dryRun = false } = {}) {
  if (!connection.externalAccountId) throw new Error('Missing eToro account identity.');
  const mapped = mapSnapshot(payload);
  const account = `eToro ****${String(connection.externalAccountId).slice(-4)}`;
  const cash = cashSnapshot(payload.portfolio, account);
  const result = { imported: 0, updated: 0, duplicates: 0, skipped: 0, failed: 0,
    tradeRows: payload.history.length, openPositionRows: mapped.trades.filter(t => !t.exitTime).length };
  await db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`etoro:${connection.userId}:${connection.externalAccountId}`]);
    const existing = (await client.query(`SELECT * FROM trades WHERE user_id=$1 AND broker='etoro'
      AND (broker_connection_id=$2 OR (broker_connection_id IS NULL AND account_identifier=$3)) FOR UPDATE`,
    [connection.userId, connection.id, account])).rows;
    const plans = plan(mapped.trades, existing);
    result.imported = plans.filter(p => !p.old).length;
    result.updated = plans.filter(p => p.old).length;
    if (dryRun) return;
    for (const { trade: t, old } of plans) {
      const original = old && getExecutions(old)[0];
      if (original?.etoro_source_type) {
        if (original.etoro_source_type === 'CFD') t.instrumentType = 'cfd';
        t.executions = t.executions.map(e => ({ ...e, etoro_source_type: original.etoro_source_type,
          etoro_copied_from: original.etoro_copied_from || null,
          etoro_leverage: original.etoro_leverage || 1 }));
      }
      const cost = t.entryPrice * t.quantity;
      const values = [connection.userId, t.symbol, (t.exitTime || t.entryTime).slice(0, 10),
        t.entryTime, t.exitTime, t.entryPrice, t.exitPrice, t.quantity, t.side,
        t.fees, t.pnl, t.pnl == null ? null : t.pnl / cost * 100,
        JSON.stringify(t.executions), connection.id, account, t.instrumentType];
      if (old) {
        await client.query(`UPDATE trades SET symbol=$2,trade_date=$3,entry_time=$4,exit_time=$5,
          entry_price=$6,exit_price=$7,quantity=$8,side=$9,fees=$10,pnl=$11,pnl_percent=$12,
          executions=$13::jsonb,broker_connection_id=$14,account_identifier=$15,instrument_type=$16,
          original_currency='USD',exchange_rate=1,commission=0,updated_at=NOW()
          WHERE user_id=$1 AND id=$17`, [...values, old.id]);
      } else {
        await client.query(`INSERT INTO trades(user_id,symbol,trade_date,entry_time,exit_time,
          entry_price,exit_price,quantity,side,fees,pnl,pnl_percent,executions,
          broker_connection_id,account_identifier,instrument_type,broker,original_currency,exchange_rate,commission)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,'etoro','USD',1,0)`, values);
      }
    }
    await client.query(`INSERT INTO broker_portfolio_snapshots(user_id,broker_type,account_identifier,connection_id,positions)
      VALUES($1,'etoro',$2,$3,$4::jsonb) ON CONFLICT(user_id,broker_type,account_identifier)
      DO UPDATE SET connection_id=EXCLUDED.connection_id,positions=EXCLUDED.positions,synced_at=NOW()`,
    [connection.userId, account, connection.id, JSON.stringify(mapped.positions)]);
    await client.query(`UPDATE broker_connections SET broker_metadata=COALESCE(broker_metadata,'{}'::jsonb)
      || $3::jsonb WHERE id=$1 AND user_id=$2`, [connection.id, connection.userId,
      JSON.stringify({import_pending_review:false,cash_balance:cash})]);
    await client.query('DELETE FROM analytics_cache WHERE user_id=$1', [connection.userId]);
  });
  if (!dryRun) await AnalyticsCache.invalidate(connection.userId);
  return result;
}
module.exports = { mapSnapshot, plan, reconcile, cashSnapshot };
