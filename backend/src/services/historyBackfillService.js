const db = require('../config/database');
const { missingRanges } = require('./holdingsHistoryProvider');
const { assetCode } = require('./brokerSync/krakenReconcile');
const { historicalMarketSymbol } = require('./portfolioCorporateActions');
const TYPE = 'historical_price_backfill';
const DAY = 86400000;
const iso = value => new Date(value).toISOString().slice(0, 10);
const fiat = new Set(['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'CHF', 'JPY', 'NZD', 'HKD', 'SGD']);

// Persisted queue entries survive restarts. A running job may have one follow-up
// queued, so a new sync can never silently disappear behind an older plan.
async function enqueue(userId) {
  const id = await db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`history-backfill:${userId}`]);
    const old = await client.query("SELECT id FROM job_queue WHERE user_id=$1 AND type=$2 AND status='pending' LIMIT 1", [userId, TYPE]);
    if (old.rows.length) return old.rows[0].id;
    return (await client.query(`INSERT INTO job_queue(type,user_id,data,status,priority)
      VALUES($1,$2,$3,'pending',4) RETURNING id`, [TYPE, userId, JSON.stringify({ version: 1 })])).rows[0].id;
  });
  const queue = require('../utils/jobQueue');
  queue.notifyJobEnqueued([TYPE]);
  return id;
}
function addTask(map, symbol, type, from, to) {
  if (!symbol || !from || !Number.isFinite(Date.parse(from))) return;
  symbol = String(symbol).toUpperCase();
  const key = `${type}:${symbol}`;
  const old = map.get(key);
  if (from > to) return;
  map.set(key, { symbol, instrumentType: type, from: old?.from < from ? old.from : from, to: old?.to > to ? old.to : to });
}
async function plan(userId) {
  const end = iso(Date.now() - DAY), tasks = new Map();
  const trades = (await db.query('SELECT symbol,instrument_type,underlying_symbol,entry_time,exit_time,trade_date FROM trades WHERE user_id=$1', [userId])).rows;
  for (const t of trades) {
    const type = t.instrument_type === 'crypto' ? 'crypto' : 'stock';
    const symbol = ['option','future'].includes(t.instrument_type) ? t.underlying_symbol : t.symbol;
    if (!symbol) continue;
    const entered = iso(t.entry_time || t.trade_date);
    const market = historicalMarketSymbol(symbol, type, entered);
    addTask(tasks, type === 'crypto' ? market.replace(/-USD$/, '') : market, type,
      iso(Date.parse(entered) - 30 * DAY), t.exit_time ? [iso(Date.parse(t.exit_time) + 30 * DAY), end].sort()[0] : end);
  }
  const positions = await require('./portfolioService')._getPositionComponents(userId, []);
  for (const p of positions) {
    if (!p.effectiveDate) continue;
    addTask(tasks, p.symbol, p.instrumentType === 'crypto' ? 'crypto' : 'stock', iso(p.effectiveDate), end);
  }
  // Closed coins and Earn/stablecoin balances may exist only in native ledgers.
  const snapshots = (await db.query('SELECT broker_type,payload FROM broker_import_snapshots WHERE user_id=$1', [userId])).rows;
  for (const s of snapshots) {
    const events = s.broker_type === 'kraken' ? Object.values(s.payload?.ledger || {}).map(r => ({ symbol: assetCode(r.asset), time: Number(r.time) * 1000 }))
      : s.broker_type === 'okx' ? (s.payload?.bills || []).map(r => ({ symbol: r.ccy, time: Number(r.ts) })) : [];
    for (const e of events) if (e.symbol && !fiat.has(e.symbol) && Number.isFinite(e.time)) addTask(tasks, e.symbol, 'crypto', iso(e.time), end);
  }
  if (tasks.size) {
    const preferences = (await db.query('SELECT default_benchmark_symbol FROM portfolio_preferences WHERE user_id=$1', [userId])).rows[0];
    addTask(tasks, preferences?.default_benchmark_symbol || 'SPY', 'stock', [...tasks.values()].map(t => t.from).sort()[0], end);
  }
  return [...tasks.values()].sort((a,b) => a.from.localeCompare(b.from) || a.symbol.localeCompare(b.symbol));
}
async function progress(jobId, value) {
  await db.query("UPDATE job_queue SET result=$2, started_at=NOW() WHERE id=$1 AND status='processing'", [jobId, JSON.stringify(value)]);
}
async function process(job) {
  let saved = typeof job.result === 'string' ? JSON.parse(job.result) : job.result;
  const tasks = saved?.tasks || await plan(job.user_id);
  const state = saved?.tasks ? saved : { tasks, processed: 0, complete: 0, gaps: [], stage: 'prices', total: tasks.length };
  // Heartbeat protects a legitimate long backfill from stuck-job recovery.
  const timer = setInterval(() => progress(job.id, state).catch(() => {}), 30000);
  timer.unref?.();
  try {
    await progress(job.id, state);
    for (let i = state.processed; i < tasks.length; i++) {
      const task = tasks[i];
      state.currentSymbol = task.symbol;
      await progress(job.id, state);
      try {
        const prices = await require('./portfolioService')._getDailySeries(task.symbol, task.from, task.to, job.user_id, { instrumentType: task.instrumentType });
        const absent = missingRanges(prices, task.from, task.to, task.instrumentType === 'crypto');
        if (absent.length) state.gaps.push({ ...task, ranges: absent, reason: task.instrumentType === 'crypto' ? 'No finalized broker/provider prices for these dates' : 'No prices returned; dates may include exchange holidays or unsupported history' });
        else state.complete++;
      } catch {
        state.gaps.push({ ...task, ranges: [{ from: task.from, to: task.to }], reason: 'History download unavailable; next sync will retry missing dates' });
      }
      state.processed = i + 1;
      await progress(job.id, state);
    }
    state.stage = 'portfolio'; state.currentSymbol = null;
    await progress(job.id, state);
    // Reconstruction also needs currency/split-aware closes and dated FX.
    // Its corporate-action rules and statement NAV precedence are preserved.
    const maintenance = await require('./brokerPortfolioMaintenance').maintain(job.user_id, { fetchPrices: true });
    state.portfolioWarnings = maintenance.warnings;
    await require('./analyticsCache').invalidate(job.user_id);
    state.stage = 'finished';
    await progress(job.id, state);
    return state;
  } finally { clearInterval(timer); }
}
async function status(userId) {
  const rows = (await db.query(`SELECT id,status,result,created_at,completed_at FROM job_queue
    WHERE user_id=$1 AND type=$2 ORDER BY CASE WHEN status IN ('pending','processing') THEN 0 ELSE 1 END,created_at DESC LIMIT 2`, [userId, TYPE])).rows;
  return rows.map(row => {
    const result = typeof row.result === 'string' ? JSON.parse(row.result) : row.result || {};
    return { id: row.id, status: row.status, stage: result.stage || 'queued', processed: result.processed || 0,
      total: result.total || 0, complete: result.complete || 0, currentSymbol: result.currentSymbol || null,
      gaps: result.gaps || [], portfolioWarnings: result.portfolioWarnings || [], createdAt: row.created_at, completedAt: row.completed_at };
  });
}
// A separate lane avoids delaying emails or occupying short enrichment slots.
// The persisted lease is renewed by process(); restart recovery resumes its cursor.
let running = false, busy = false, pollTimer;
function schedule(delay) {
  clearTimeout(pollTimer);
  if (running) { pollTimer = setTimeout(poll, delay); pollTimer.unref?.(); }
}
async function claim() {
  return (await db.query(`UPDATE job_queue SET status='processing',started_at=NOW()
    WHERE id=(SELECT id FROM job_queue WHERE type=$1 AND status='pending'
      ORDER BY priority,created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, [TYPE])).rows[0];
}
async function poll() {
  if (!running || busy) return;
  busy = true;
  let job;
  try {
    job = await claim();
    if (job) {
      try { await require('../utils/jobQueue').completeJob(job.id, await process(job)); }
      catch { await require('../utils/jobQueue').failJob(job.id, 'Historical backfill could not finish; saved prices remain available. Retry the history update.'); }
    }
  } catch { /* Database recovery is handled by the next bounded poll. */ }
  finally { busy = false; schedule(job ? 1000 : 30000); }
}
function start() { if (!running) { running = true; schedule(0); } }
function stop() { running = false; clearTimeout(pollTimer); }
function nudge() { if (running && !busy) schedule(0); }
module.exports = { enqueue, process, plan, status, addTask, TYPE, claim, start, stop, nudge };
