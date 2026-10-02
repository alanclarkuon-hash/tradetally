const db = require('../../config/database');
const AnalyticsCache = require('../analyticsCache');

function numeric(value, name, positive = false) {
  if (value == null || value === '' || !Number.isFinite(Number(value)) || (positive && Number(value) <= 0)) {
    throw new Error(`Missing or invalid statement ${name}. No history imported.`);
  }
  return Number(value);
}
function statementDate(value) {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Unexpected eToro statement date format.');
  const date = `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  if (Number.isNaN(Date.parse(date)) || new Date(date).toISOString() !== date) throw new Error('Invalid statement date.');
  return date;
}
function mapClosedPositions(rows) {
  if (!Array.isArray(rows)) throw new Error('Missing closed positions sheet.');
  const ids = new Set();
  return rows.map(row => {
    const id = String(row['Position ID'] || '');
    if (!/^\d+$/.test(id) || ids.has(id)) throw new Error('Duplicate or missing statement position identity.');
    ids.add(id);
    const symbol = String(row.Action).match(/\(([^()]+)\)\s*$/)?.[1]?.toUpperCase();
    const type = { Stocks: 'stock', ETF: 'stock', Crypto: 'crypto', CFD: 'cfd' }[row.Type];
    if (!symbol || !type || !['Long','Short'].includes(row['Long / Short'])) throw new Error('Unidentified statement asset or direction.');
    const quantity = numeric(row['Units / Contracts'], 'units', true);
    const leverage = numeric(row.Leverage, 'leverage', true);
    const capital = numeric(row.Amount, 'invested amount');
    const fxOpen = row['FX rate at open (USD)'] === '-' ? 1 : numeric(row['FX rate at open (USD)'], 'opening FX', true);
    const fxClose = row['FX rate at close (USD)'] === '-' ? 1 : numeric(row['FX rate at close (USD)'], 'closing FX', true);
    const entryPrice = numeric(row['Open Rate'], 'opening rate') * fxOpen;
    const exitPrice = numeric(row['Close Rate'], 'closing rate') * fxClose;
    if (capital < 0 || entryPrice < 0 || exitPrice < 0) throw new Error('Negative statement price or capital.');
    const pnl = numeric(row['Profit(USD)'], 'USD profit');
    const entryTime = statementDate(row['Open Date']);
    const exitTime = statementDate(row['Close Date']);
    if (entryTime > exitTime) throw new Error('Statement closes before its opening date.');
    const side = row['Long / Short'] === 'Long' ? 'long' : 'short';
    const common = { etoro_position_id: id, etoro_record_key: `statement:${id}`,
      etoro_statement_source: true, etoro_leverage: leverage,
      etoro_copied_from: row['Copied From'] === '-' ? null : row['Copied From'],
      etoro_source_type: row.Type };
    // Preserve reported USD profit, not a reconstruction from rounded prices,
    // splits, FX or fees already incorporated into the broker's execution rates.
    return { positionId: id, symbol, type, quantity, entryTime, exitTime, entryPrice, exitPrice,
      side, pnl, pnlPercent: capital > 0 ? pnl / capital * 100 : null,
      executions: [
        { ...common, type: 'entry', action: side === 'long' ? 'buy' : 'sell', quantity,
          price: entryPrice, datetime: entryTime, etoro_native_price: Number(row['Open Rate']), etoro_fx: fxOpen },
        { ...common, type: 'exit', action: side === 'long' ? 'sell' : 'buy', quantity,
          price: exitPrice, datetime: exitTime, realized_pnl: pnl, exit_date: exitTime.slice(0,10),
          etoro_reported_net_profit: pnl, etoro_native_price: Number(row['Close Rate']), etoro_fx: fxClose,
          etoro_spread_fees: row['Spread Fees (USD)'], etoro_market_spread: row['Market Spread (USD)'],
          etoro_overnight_fees_and_dividends: row['Overnight Fees and Dividends'] }
      ] };
  });
}
function matches(existing, trade) {
  return Math.abs(Number(existing.quantity) - trade.quantity) < 0.00001 &&
    Math.abs(Number(existing.pnl) - trade.pnl) <= 0.021 &&
    Math.floor(new Date(existing.entry_time).getTime() / 1000) === Math.floor(Date.parse(trade.entryTime) / 1000) &&
    Math.floor(new Date(existing.exit_time).getTime() / 1000) === Math.floor(Date.parse(trade.exitTime) / 1000);
}

async function importClosedPositions(connection, statement, { dryRun = false } = {}) {
  const trades = mapClosedPositions(statement['Closed Positions']);
  const account = `eToro ****${String(connection.externalAccountId).slice(-4)}`;
  const result = await db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`etoro:${connection.userId}:${connection.externalAccountId}`]);
    const existing = (await client.query(`SELECT * FROM trades WHERE user_id=$1 AND broker='etoro'
      AND (broker_connection_id=$2 OR (broker_connection_id IS NULL AND account_identifier=$3)) FOR UPDATE`,
    [connection.userId, connection.id, account])).rows;
    const byId = new Map();
    for (const row of existing) {
      const exec = typeof row.executions === 'string' ? JSON.parse(row.executions) : row.executions;
      const id = exec?.[0]?.etoro_position_id;
      if (!id) throw new Error('Existing eToro trade lacks broker identity.');
      const rows = byId.get(String(id)) || []; rows.push(row); byId.set(String(id), rows);
    }
    const fresh = [];
    const verified = [];
    let matched = 0;
    for (const t of trades) {
      const previous = byId.get(t.positionId) || [];
      if (!previous.length) { fresh.push(t); continue; }
      if (previous.length !== 1 || !matches(previous[0], t) || previous[0].symbol !== t.symbol) {
        throw new Error('An overlapping eToro statement position needs review. No history imported.');
      }
      matched++;
      verified.push({ old: previous[0], trade: t });
    }
    const result = { imported: fresh.length, matched, rows: trades.length, dryRun };
    if (dryRun) return result;
    for (const { old, trade: t } of verified) {
      // Keep API precision and IDs; add statement-confirmed CFD/copy metadata.
      const original = typeof old.executions === 'string' ? JSON.parse(old.executions) : old.executions;
      const executions = original.map(e => ({ ...e, etoro_source_type: t.executions[0].etoro_source_type,
        etoro_copied_from: t.executions[0].etoro_copied_from, etoro_leverage: t.executions[0].etoro_leverage }));
      await client.query('UPDATE trades SET instrument_type=$1,executions=$2::jsonb,updated_at=NOW() WHERE id=$3 AND user_id=$4',
      [t.type,JSON.stringify(executions),old.id,connection.userId]);
    }
    for (let offset = 0; offset < fresh.length; offset += 250) {
      const params = [];
      const values = fresh.slice(offset, offset + 250).map(t => {
        const first = params.length;
        params.push(connection.userId,t.symbol,t.exitTime.slice(0,10),t.entryTime,t.exitTime,
          t.entryPrice,t.exitPrice,t.quantity,t.side,t.pnl,t.pnlPercent,JSON.stringify(t.executions),
          connection.id,account,t.type);
        return '(' + Array.from({length:15},(_,i)=>`$${first+i+1}`).join(',') + ",'etoro','USD',1,0,0)";
      });
      await client.query(`INSERT INTO trades(user_id,symbol,trade_date,entry_time,exit_time,
        entry_price,exit_price,quantity,side,pnl,pnl_percent,executions,broker_connection_id,
        account_identifier,instrument_type,broker,original_currency,exchange_rate,commission,fees)
        VALUES ${values.join(',')}`, params);
    }
    await client.query('DELETE FROM analytics_cache WHERE user_id=$1', [connection.userId]);
    return result;
  });
  if (!dryRun) await AnalyticsCache.invalidate(connection.userId);
  return result;
}
module.exports = { mapClosedPositions, statementDate, matches, importClosedPositions };
