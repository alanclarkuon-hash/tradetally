const { fxUsd } = require('./tradeFx');

// Only these expressions can reach SQL. Never interpolate a request column.
const text = column => `NULLIF(LOWER(t.${column}), '')`;
const closed = expression => `CASE WHEN COALESCE(t.exit_price, 0) <> 0 OR t.exit_time IS NOT NULL THEN ${expression} END`;
const expressions = {
  symbol: text('symbol'), entryDate: 't.entry_time', exitDate: 't.exit_time',
  entryTime: 't.entry_time', side: text('side'), entry: fxUsd('entry_price'),
  exit: fxUsd('exit_price'), pnl: closed(fxUsd('pnl')),
  grossPnl: closed(`COALESCE(${fxUsd('pnl')},0) + COALESCE(${fxUsd('commission')},0) + COALESCE(${fxUsd('fees')},0)`),
  confidence: 'NULLIF(t.confidence, 0)', quality: text('quality_grade'),
  sector: "NULLIF(LOWER((SELECT category.finnhub_industry FROM symbol_categories category WHERE category.symbol = t.symbol)), '')",
  status: "CASE WHEN COALESCE(t.exit_price, 0) = 0 AND t.exit_time IS NULL THEN 'open' ELSE 'closed' END",
  comments: '(SELECT COUNT(*) FROM trade_comments sort_comments WHERE sort_comments.trade_id = t.id)',
  quantity: 't.quantity', commission: fxUsd('commission'), fees: fxUsd('fees'),
  strategy: "LOWER(COALESCE(NULLIF(t.strategy, ''), (SELECT replace(pg.detected_strategy, '_', ' ') FROM trade_position_groups pg WHERE pg.id = t.position_group_id)))", setup: text('setup'), broker: text('broker'),
  account: text('account_identifier'), tags: "NULLIF(LOWER(array_to_string(t.tags, ', ')), '')",
  notes: text('notes'), holdTime: 'EXTRACT(EPOCH FROM (t.exit_time - t.entry_time))/60',
  roi: 't.pnl_percent', stopLoss: fxUsd('stop_loss'), takeProfit: fxUsd('take_profit'),
  rValue: 't.r_value', mae: fxUsd('mae'), mfe: fxUsd('mfe'),
  instrumentType: text('instrument_type'), underlyingSymbol: text('underlying_symbol'),
  optionType: text('option_type'), strikePrice: fxUsd('strike_price'),
  expirationDate: 't.expiration_date', contractSize: 't.contract_size',
  heartRate: 'NULLIF(t.heart_rate, 0)', sleepHours: 'NULLIF(t.sleep_hours, 0)', sleepScore: 'NULLIF(t.sleep_score, 0)'
};

function tradeListSort(sortBy = 'entryDate', sortDirection = 'desc') {
  if (!Object.hasOwn(expressions, sortBy) || !['asc', 'desc'].includes(sortDirection)) {
    const error = new Error('Invalid trade sort column or direction');
    error.status = 400;
    throw error;
  }
  return { expression: expressions[sortBy], direction: sortDirection.toUpperCase() };
}

module.exports = { tradeListSort };
