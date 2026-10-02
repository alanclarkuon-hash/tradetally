// Exact-execution repair for the original account/instrument currency mix-up.
// Dry-run by default. --apply creates a backup and updates in one transaction.
const fs = require('fs/promises');
const db = require('../src/config/database');
const service = require('../src/services/brokerSync/trading212Service');
const { computeTradePnl } = require('../src/services/pnlEngine');

function buildRepair(trade, historyById, timezone) {
  if (trade.original_entry_price_currency != null) throw new Error('Already converted price columns');
  const oldExecutions = typeof trade.executions === 'string' ? JSON.parse(trade.executions) : trade.executions;
  if (!Array.isArray(oldExecutions) || !oldExecutions.length) throw new Error('Missing executions');
  const symbols = new Set();
  const currencies = new Set();
  let divisor = null;
  const executions = oldExecutions.map(e => {
    const raw = historyById.get(String(e.order_id ?? e.orderId));
    if (!raw) throw new Error('Execution not found in broker history');
    const mapped = service.mapExecutionToFill(raw);
    if (!mapped || mapped.action !== String(e.action).toLowerCase()) throw new Error('Execution action mismatch');
    if (Math.abs(Number(e.price) - Number(raw.fill.price)) > 0.000001) throw new Error('Price edited or already repaired');
    const scale = Number(raw.fill.price) / mapped.price;
    if (divisor != null && Math.abs(divisor - scale) > 0.000001) throw new Error('Mixed price units');
    divisor = scale;
    symbols.add(mapped.symbol);
    currencies.add(mapped.currency);
    const costShare = Number(e.quantity) / Math.abs(Number(raw.fill.quantity));
    return { ...e, price: mapped.price, currency: mapped.currency,
      commission: mapped.commission * costShare, fees: mapped.fees * costShare,
      fx_rate: 1, account_currency: mapped.accountCurrency, broker_fx_rate: mapped.brokerFxRate };
  });
  if (symbols.size !== 1 || currencies.size !== 1) throw new Error('Mixed instruments or currencies');
  const result = computeTradePnl({side: trade.side, instrumentType: trade.instrument_type || 'stock',
    executions, timezone});
  const a = result.aggregate;
  if (Math.abs(a.quantity - Number(trade.quantity)) > 0.000001) throw new Error('Quantity mismatch');
  const stopLoss = trade.stop_loss == null ? null : Number(trade.stop_loss) / divisor;
  const risk = stopLoss == null ? 0 : Math.abs(a.entry_price - stopLoss) * a.quantity;
  return { symbol: [...symbols][0], currency: [...currencies][0], aggregate: a,
    executions: result.annotatedExecutions, stopLoss,
    takeProfit: trade.take_profit == null ? null : Number(trade.take_profit) / divisor,
    rValue: risk > 0 && a.pnl != null ? a.pnl / risk : null };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const history = JSON.parse(await fs.readFile('/app/backend/src/data/trading212-repair-history.json', 'utf8'));
  const historyById = new Map(history.map(x => [String(x.fill.id), x]));
  const rows = await db.query("SELECT t.*, t.updated_at::text AS repair_updated_at, u.timezone FROM trades t JOIN users u ON u.id=t.user_id WHERE t.broker='trading212'");
  const plans = [];
  const skipped = {};
  for (const trade of rows.rows) {
    try { plans.push({trade, repair:buildRepair(trade, historyById, trade.timezone)}); }
    catch(e) { skipped[e.message] = (skipped[e.message] || 0) + 1; }
  }
  const summary = {mode:apply?'apply':'dry-run',matched:plans.length,skipped,
    renamed:plans.filter(p=>p.trade.symbol!==p.repair.symbol).length,
    currencyCorrected:plans.filter(p=>p.trade.original_currency!==p.repair.currency).length};
  console.log(JSON.stringify(summary));
  if (!apply || !plans.length) return;
  const users = [...new Set(plans.map(p=>p.trade.user_id))];
  if (users.length !== 1) throw new Error('Repair requires one owner');
  const running = await db.query("SELECT COUNT(*) AS n FROM broker_sync_logs WHERE status IN ('started','fetching','parsing','importing')");
  if (Number(running.rows[0].n)) throw new Error('A sync is currently running');
  await require('../src/services/backup.service').createFullSiteBackup(users[0], 'manual');
  await db.withTransaction(async client => {
    for (const {trade,repair:r} of plans) {
      const a=r.aggregate;
      const updated=await client.query(`UPDATE trades SET symbol=$1,original_currency=$2,exchange_rate=1,
        entry_price=$3,exit_price=$4,commission=$5,fees=$6,pnl=$7,pnl_percent=$8,executions=$9::jsonb,
        stop_loss=$10,take_profit=$11,r_value=$12,updated_at=NOW()
        WHERE id=$13 AND updated_at=$14`,[r.symbol,r.currency,a.entry_price,a.exit_price,a.commission,a.fees,
        a.pnl,a.pnl_percent,JSON.stringify(r.executions),r.stopLoss,r.takeProfit,r.rValue,trade.id,trade.repair_updated_at]);
      if(updated.rowCount!==1) throw new Error('Trade changed during repair; rolling back');
    }
    await client.query('DELETE FROM analytics_cache WHERE user_id=$1',[users[0]]);
  });
  console.log(JSON.stringify({repaired:plans.length}));
}

if (require.main === module) main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.pool.end());
module.exports={buildRepair};
