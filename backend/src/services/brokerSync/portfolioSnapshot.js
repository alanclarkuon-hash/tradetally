const db = require('../../config/database');
const converter = require('../../utils/currencyConverter');

async function saveTrading212Snapshot(connection, positions) {
  if (!Array.isArray(positions)) throw new Error('Invalid Trading 212 positions response');
  if (!connection.externalAccountId) throw new Error('Trading 212 account identity is missing');
  for (const p of positions) {
    if (!p.instrument?.ticker || !p.walletImpact?.currency || !Number.isFinite(Number(p.quantity)) ||
        !Number.isFinite(Number(p.walletImpact.totalCost)) || !Number.isFinite(Number(p.walletImpact.currentValue))) {
      throw new Error('Incomplete Trading 212 position');
    }
  }
  const account = `****${String(connection.externalAccountId).slice(-4)}`;
  await db.query(`INSERT INTO broker_portfolio_snapshots(user_id,broker_type,account_identifier,connection_id,positions,synced_at)
    VALUES($1,'trading212',$2,$3,$4::jsonb,NOW())
    ON CONFLICT(user_id,broker_type,account_identifier) DO UPDATE
    SET connection_id=EXCLUDED.connection_id,positions=EXCLUDED.positions,synced_at=NOW()`,
  [connection.userId, account, connection.id, JSON.stringify(positions)]);
}

// PortfolioService aggregates money in USD before response display conversion.
// Broker wallet values already include splits and the account's actual FX cost.
async function snapshotPositions(rows, accounts = []) {
  const normalizeTicker = require('./trading212Service').normalizeTicker;
  const positions = [];
  const rates = new Map([['USD', 1]]);
  for (const row of rows) {
    if (accounts.length && !accounts.includes(row.account_identifier)) continue;
    for (const p of row.positions) {
      if (['etoro','okx','kraken'].includes(row.broker_type)) {
        positions.push({ symbol: p.symbol, holdingId: null, source: 'trades', positionSource: 'broker',
          notes: p.notes || null, sector: null, targetAllocationPercent: null, totalShares: p.quantity,
          totalCostBasis: p.totalCost, averageCostBasis: p.totalCost / p.quantity,
          totalDividendsReceived: 0, dividendYieldOnCost: null, lastDividendDate: null,
          accountIdentifiers: [row.account_identifier], lotCount: p.lotCount || 1, openedAt: p.openedAt,
          brokers: row.broker_type, instrumentType: p.instrumentType, contractSize: 1, pointValue: null,
          brokerCurrentPrice: p.currentValue / p.quantity, brokerPriceAsOf: new Date(row.synced_at).toISOString() });
        continue;
      }
      const quantity = Number(p.quantity);
      if (quantity <= 0) continue;
      const currency = p.walletImpact.currency.toUpperCase();
      if (!rates.has(currency)) rates.set(currency, await converter.getDailyCrossRate(currency, 'USD'));
      const rate = Number(rates.get(currency));
      if (!(rate > 0)) throw new Error('Unable to convert broker portfolio currency');
      const totalCost = Number(p.walletImpact.totalCost) * rate;
      const value = Number(p.walletImpact.currentValue) * rate;
      positions.push({ symbol: normalizeTicker(p.instrument.ticker), holdingId: null,
        source: 'trades', positionSource: 'broker', notes: null, sector: null,
        targetAllocationPercent: null, totalShares: quantity, totalCostBasis: totalCost,
        averageCostBasis: totalCost / quantity, totalDividendsReceived: 0,
        dividendYieldOnCost: null, lastDividendDate: null, accountIdentifiers: [row.account_identifier],
        lotCount: 1, openedAt: p.createdAt, brokers: 'trading212', instrumentType: 'stock',
        contractSize: 1, pointValue: null, brokerCurrentPrice: value / quantity,
        brokerPriceAsOf: new Date(row.synced_at).toISOString() });
    }
  }
  return positions;
}

function dashboardPositions(openTrades, snapshots, accounts = []) {
  const { groupTradesIntoPositions, getPositionKey } = require('../../utils/openPositionGrouping');
  const normalizeTicker = require('./trading212Service').normalizeTicker;
  const covered = snapshots.filter(row => !accounts.length || accounts.includes(row.account_identifier));
  const retained = openTrades.filter(t => !covered.some(row =>
    t.broker === row.broker_type && t.account_identifier === row.account_identifier));
  const synthetic = [];
  for (const row of covered) for (const p of row.positions) {
    if (['etoro','okx','kraken'].includes(row.broker_type)) {
      const related = openTrades.filter(t => t.broker === row.broker_type &&
        t.account_identifier === row.account_identifier && t.symbol === p.symbol);
      synthetic.push({ symbol: p.symbol, side: 'long', quantity: p.quantity,
        entry_price: p.totalCost / p.quantity, entry_time: p.openedAt, original_currency: 'USD',
        instrument_type: p.instrumentType, broker: row.broker_type, account_identifier: row.account_identifier,
        _brokerRelatedTrades: related, _brokerQuote: { c: p.currentValue / p.quantity,
          currency: 'USD', asOf: new Date(row.synced_at).toISOString() } });
      continue;
    }
    const quantity = Number(p.quantity);
    if (quantity <= 0) continue;
    const symbol = normalizeTicker(p.instrument.ticker);
    const related = openTrades.filter(t => t.broker === row.broker_type &&
      t.account_identifier === row.account_identifier && t.symbol === symbol);
    synthetic.push({ symbol, side: 'long', quantity, entry_price: Number(p.walletImpact.totalCost) / quantity,
      entry_time: p.createdAt, original_currency: p.walletImpact.currency, instrument_type: 'stock',
      broker: row.broker_type, account_identifier: row.account_identifier,
      _brokerRelatedTrades: related, _brokerQuote: { c: Number(p.walletImpact.currentValue) / quantity,
        currency: p.walletImpact.currency, asOf: new Date(row.synced_at).toISOString() } });
  }
  const grouped = groupTradesIntoPositions([...retained, ...synthetic]);
  for (const t of synthetic) {
    const position = grouped[getPositionKey(t)];
    if (position) position.brokerQuote = t._brokerQuote;
  }
  for (const position of Object.values(grouped)) {
    position.trades = position.trades.flatMap(t => t._brokerRelatedTrades || [t]);
  }
  return grouped;
}

module.exports = { saveTrading212Snapshot, snapshotPositions, dashboardPositions };
