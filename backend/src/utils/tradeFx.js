const currencyConverter = require('./currencyConverter');

/**
 * Trades store amounts in their ORIGINAL currency when the import-time
 * USD conversion did not run (offline FX, manual/API creates without a
 * conversion step, import fallbacks). Aggregate SQL must normalize per-row
 * before SUM, and row displays must scale by the row's own base currency.
 * The rules here mirror the trade_amount_usd() SQL function (migration 254).
 *
 * Two conversion regimes coexist, deliberately:
 *   - A row converted AT IMPORT holds USD struck at the trade-date rate, and
 *     that number never moves again.
 *   - A row still in its native currency is converted AT QUERY TIME with the
 *     latest stored snapshot, so its USD value drifts with the market.
 * The same EUR trade therefore reports slightly different USD totals
 * depending on which path stored it. Converting native rows at their own
 * trade-date rate would need a per-row dated lookup inside every aggregate
 * (trade_amount_usd is a single indexed read today), so the approximation is
 * accepted: it keeps mixed-currency sums meaningful, which is the thing that
 * was actually broken. See migration 254 for the SQL side of the same rule.
 */

/**
 * Effective base currency of a stored trade row: 'USD' when the row was
 * converted at import, otherwise its original_currency (default USD).
 * Only the pre-conversion columns mark a rewrite - exchange_rate is NOT one
 * (manual/API/OAuth trades can carry a rate beside an unconverted price);
 * this mirrors utils/openPositionGrouping.js storedCurrency() and SQL
 * function trade_amount_usd (migrations 254/255).
 */
function tradeBaseCurrency(row) {
  if (!row || typeof row !== 'object') return 'USD';
  const converted = row.original_entry_price_currency != null
    || row.originalEntryPriceCurrency != null
    || row.original_pnl_currency != null
    || row.originalPnlCurrency != null
    || row.original_exit_price_currency != null;
  if (converted) return 'USD';
  const orig = String(row.original_currency || row.originalCurrency || 'USD').toUpperCase();
  return orig || 'USD';
}

// SQL fragment wrapping a trades-column into its USD-normalized value.
// Usage: `AVG(${fxUsd('pnl')})` -> AVG(trade_amount_usd(t.pnl, ...))
function fxUsd(column, alias = 't') {
  const a = alias ? `${alias}.` : '';
  const native=`trade_amount_usd(${a}${column}, ${a}original_currency, ${a}exchange_rate, ${a}original_entry_price_currency)`;
  return ['pnl','commission','fees'].includes(column) ? `CASE WHEN EXISTS(SELECT 1 FROM trade_account_reports ar WHERE ar.trade_id=${a}id) THEN trade_account_report_usd(${a}id, '${column}') ELSE ${native} END` : native;
}

/**
 * USD-per-currency map for today (from the daily FX store). Returns null
 * when no snapshot is available (offline before first fetch) - callers then
 * skip normalization and keep the previous single-currency behavior.
 */
async function getUsdRateMap() {
  try {
    return await currencyConverter.getRateMap('USD');
  } catch (error) {
    console.warn(`[CURRENCY] USD rate map unavailable, trade aggregates stay as stored: ${error.message}`);
    return null;
  }
}

/**
 * Normalize one materialized trade row's amounts from its original currency
 * to USD in place, including money fields inside its executions JSONB.
 * Returns the multiplier applied (1 for USD-base rows).
 */
function normalizeRowToUsd(row, usdRates) {
  const base = tradeBaseCurrency(row);
  if (!usdRates) return 1;
  const perUsd = base==='USD'?1:Number(usdRates[base]);
  if (!Number.isFinite(perUsd) || perUsd <= 0) return 1;
  const mult = 1 / perUsd;

  const scale = (obj, keys) => {
    for (const key of keys) {
      const v = obj?.[key];
      if (typeof v === 'number' && Number.isFinite(v)) obj[key] = v * mult;
      else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) obj[key] = String(Number(v) * mult);
    }
  };

  // MAE/MFE belong here with the prices they are measured against: exit
  // efficiency and "profit left on the table" divide an excursion by a P&L,
  // so converting one and not the other silently compares EUR to USD.
  scale(row, [
    'pnl', 'commission', 'fees', 'entry_price', 'exit_price', 'stop_loss',
    'take_profit', 'current_price', 'net_amount', 'amount',
    'mae', 'mfe', 'post_exit_mae', 'post_exit_mfe'
  ]);

  let execs = row.executions;
  if (typeof execs === 'string') {
    try { execs = JSON.parse(execs); } catch { execs = null; }
  }
  if (Array.isArray(execs)) {
    for (const exec of execs) {
      if (!exec || typeof exec !== 'object') continue;
      scale(exec, ['price', 'entryPrice', 'entry_price', 'exitPrice', 'exit_price', 'pnl', 'p_l', 'commission', 'fees']);
    }
  }
  applyAccountResult(row, code=>code==='USD'?1:usdRates[code]>0?1/Number(usdRates[code]):null);
  return mult;
}

// The account cache is immutable metadata; only response copies are overlaid.
function applyAccountResult(row, rateForCurrency) {
 const result=row?.account_pnl_result;if(!result)return;
 const rate=rateForCurrency(result.currency);
 if(result.status!=='complete'||!(rate>0)){row.pnl=null;row.pnl_percent=null;row.pnlPercent=null;row.account_pnl_coverage='unavailable';if(Array.isArray(row.executions))for(const e of row.executions){e.realized_pnl=null;e.gross_realized_pnl=null;}return;}
 row.account_pnl_reporting_rate=rate;row.account_pnl_coverage='complete';
 row.pnl=result.pnl==null?null:Number(result.pnl)*rate;
 if(row.profit_loss!==undefined)row.profit_loss=row.pnl;
 if(row.trade_pnl!==undefined)row.trade_pnl=row.pnl;
 row.commission=Number(result.commission||0)*rate;row.fees=Number(result.fees||0)*rate;
 const percent=result.pnl!=null&&result.entryCost>0?Number(result.pnl)/Number(result.entryCost)*100:null;
 if(row.pnl_percent!==undefined)row.pnl_percent=percent;
 if(row.pnlPercent!==undefined)row.pnlPercent=percent;
 if(row.gross_pnl!==undefined)row.gross_pnl=row.pnl==null?null:row.pnl+row.commission+row.fees;
 if(Array.isArray(row.executions))for(const [index,execution] of row.executions.entries()) {
  const events=(result.events||[]).filter(e=>e.sourceIndex===index);
  if(events.length){execution.realized_pnl=events.reduce((sum,e)=>sum+e.pnl,0)*rate;execution.gross_realized_pnl=events.reduce((sum,e)=>sum+e.gross_pnl,0)*rate;}
 }
}
module.exports = {
  tradeBaseCurrency,
  applyAccountResult,
  tradeAmountUsd: fxUsd,
  fxUsd,
  getUsdRateMap,
  normalizeRowToUsd
};
