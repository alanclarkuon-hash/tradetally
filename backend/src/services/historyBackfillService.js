const db = require('../config/database');
const { missingRanges } = require('./holdingsHistoryProvider');
const { assetCode } = require('./brokerSync/krakenReconcile');
const {identity}=require('./historyInstrumentIdentity');
const TYPE = 'historical_price_backfill';
const DAY = 86400000;
const iso = value => new Date(value).toISOString().slice(0, 10);
const fiat = new Set(['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'CHF', 'JPY', 'NZD', 'HKD', 'SGD']);

// Persisted queue entries survive restarts. A running job may have one follow-up
// queued, so a new sync can never silently disappear behind an older plan.
function mergeScope(left, right) {
  if (!left || !right) return null; // Explicit full maintenance dominates.
  const accounts = { ...left.accounts };
  for (const [id, from] of Object.entries(right.accounts)) accounts[id] = Object.hasOwn(accounts,id) ? accounts[id] && from ? [accounts[id],from].sort()[0] : null : from;
  return { accounts };
}
async function enqueue(userId, scope = null) {
  if (scope && !Object.keys(scope.accounts).length) return null;
  const id = await db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`history-backfill:${userId}`]);
    // A resumed job already has a price cursor; never replace its task plan.
    const old = await client.query("SELECT id,data FROM job_queue WHERE user_id=$1 AND type=$2 AND status='pending' AND result IS NULL AND COALESCE(data->>'mode','')='' ORDER BY created_at LIMIT 1 FOR UPDATE", [userId, TYPE]);
    if (old.rows.length) {
      const row = old.rows[0], data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const merged = mergeScope(data?.scope, scope);
      if (data?.scope) await client.query("UPDATE job_queue SET data=$2 WHERE id=$1 AND status='pending'", [row.id, JSON.stringify({version:2,scope:merged})]);
      return row.id;
    }
    return (await client.query(`INSERT INTO job_queue(type,user_id,data,status,priority)
      VALUES($1,$2,$3,'pending',4) RETURNING id`, [TYPE, userId, JSON.stringify({ version: 2, scope })])).rows[0].id;
  });
  require('../utils/jobQueue').notifyJobEnqueued([TYPE]);
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
async function plan(userId, scope = null) {
  const accounts = scope ? Object.keys(scope.accounts) : [];
  if (scope && !accounts.length) return [];
  if (accounts.length > 1) {
    const combined=new Map();
    for (const id of accounts) for (const task of await plan(userId,{accounts:{[id]:scope.accounts[id]}})) {if(task.unsupported)combined.set(`${task.instrumentType}:${task.symbol}`,task);else addTask(combined,task.symbol,task.instrumentType,task.from,task.to);}
    return [...combined.values()].sort((a,b)=>a.from.localeCompare(b.from)||a.symbol.localeCompare(b.symbol));
  }
  const floor = scope ? Object.values(scope.accounts).filter(Boolean).sort()[0] : null;
  const scopedTask = (symbol,type,from,to) => addTask(tasks,symbol,type,floor && from < floor ? floor : from,to);
  const end = iso(Date.now() - DAY), tasks = new Map(),requiredDates=new Map();
  const requireFrom=(symbol,type,day)=>{const key=type+':'+String(symbol).toUpperCase(),old=requiredDates.get(key);if(!old||day<old)requiredDates.set(key,day);};
  const trades = (await db.query('SELECT symbol,instrument_type,underlying_symbol,entry_time,exit_time,trade_date,broker,account_identifier,executions,entry_price,quantity FROM trades WHERE user_id=$1 AND ($2::text[] IS NULL OR account_identifier=ANY($2))', [userId, scope ? accounts : null])).rows;
  await require('./brokerInstrumentSymbols').applyTradeHistoricalSymbols(db,userId,trades);
  for (const t of trades) {
    const entered = iso(t.entry_time || t.trade_date);
    const market=identity(t,entered);
    if(market.unsupported) {
      tasks.set(`${market.instrumentType}:${market.symbol}`,{...market,from:entered,to:end});
      continue;
    }
    if(!market.symbol)continue;
    requireFrom(market.symbol,market.instrumentType,entered);
    scopedTask(market.symbol,market.instrumentType,
      iso(Date.parse(entered) - 30 * DAY), t.exit_time ? [iso(Date.parse(t.exit_time) + 30 * DAY), end].sort()[0] : end);
  }
  const positions = await require('./portfolioService')._getPositionComponents(userId, accounts);
  for (const p of positions) {
    if (!p.effectiveDate) continue;
    // Reuse a listing only when every contributing account/lot agrees.
    const owners=p.accountIdentifiers||[];
    const related=trades.filter(t=>owners.includes(t.account_identifier)&&t.symbol===p.symbol&&(t.instrument_type||'stock')===(p.instrumentType||'stock'));
    const listings=new Set(related.map(t=>identity(t,iso(t.entry_time||t.trade_date)).symbol));
    const verified=owners.length&&owners.every(a=>related.some(t=>t.account_identifier===a))&&listings.size===1;
    const market=identity(verified?{...p,history_market_symbol:[...listings][0]}:p,iso(p.effectiveDate));
    if(market.unsupported)tasks.set(`${market.instrumentType}:${market.symbol}`,{...market,from:iso(p.effectiveDate),to:end});
    else {requireFrom(market.symbol,market.instrumentType,iso(p.effectiveDate));scopedTask(market.symbol,market.instrumentType,iso(p.effectiveDate),end);}
  }
  // Closed coins and Earn/stablecoin balances may exist only in native ledgers.
  const snapshots = (await db.query('SELECT broker_type,payload FROM broker_import_snapshots WHERE user_id=$1 AND ($2::text[] IS NULL OR account_identifier=ANY($2))', [userId, scope ? accounts : null])).rows;
  for (const s of scope ? [] : snapshots) {
    // Scoped reconstruction prices native coins actually held in its date window.
    const events = s.broker_type === 'kraken' ? Object.values(s.payload?.ledger || {}).map(r => ({ symbol: assetCode(r.asset), time: Number(r.time) * 1000 }))
      : s.broker_type === 'okx' ? (s.payload?.bills || []).map(r => ({ symbol: r.ccy, time: Number(r.ts) })) : [];
    for (const e of events) if (e.symbol && !fiat.has(e.symbol) && Number.isFinite(e.time)) scopedTask(e.symbol, 'crypto', iso(e.time), end);
  }
  if ([...tasks.values()].some(t=>!t.unsupported)) {
    const preferences = (await db.query('SELECT default_benchmark_symbol FROM portfolio_preferences WHERE user_id=$1', [userId])).rows[0];
    addTask(tasks, preferences?.default_benchmark_symbol || 'SPY', 'stock', [...tasks.values()].filter(t=>!t.unsupported).map(t => t.from).sort()[0], end);
  }
  const listings=(await db.query('SELECT symbol,payload FROM portfolio_reconstruction_prices WHERE symbol=ANY($1)',[[...tasks.values()].filter(t=>t.instrumentType==='stock'&&!t.unsupported).map(t=>t.symbol)])).rows;
  const metadata=new Map(listings.map(r=>[r.symbol,r.payload]));
  return [...tasks.values()].map(t=>require('./historyListingLifetime').trimPadding(t,requiredDates.get(t.instrumentType+':'+t.symbol),metadata.get(t.symbol))).sort((a,b) => a.from.localeCompare(b.from) || a.symbol.localeCompare(b.symbol));
}
function calendarCoverageReason(calendar,from,to) {
 const exchange=require('./exchangeCalendar');
 return calendar && exchange.coversRange(calendar,from,to) ? 'No prices returned for expected exchange sessions' : 'No prices returned; exchange calendar is unavailable for some requested dates';
}
async function progress(jobId, value) {
  value.lastHeartbeatAt=new Date().toISOString();
  await db.query("UPDATE job_queue SET result=$2, started_at=NOW() WHERE id=$1 AND status='processing'", [jobId, JSON.stringify(value)]);
}
async function process(job) {
  const data=typeof job.data==='string'?JSON.parse(job.data):job.data;
  if(data?.mode==='broker_refresh')return require('./priceCacheRefreshService').process(job,progress);
  let saved = typeof job.result === 'string' ? JSON.parse(job.result) : job.result;
  const tasks = saved?.tasks || await plan(job.user_id, data?.scope);
  const state = saved?.tasks ? saved : { tasks, processed: 0, complete: 0, gaps: [], stage: 'prices', total: tasks.length };
  await require('./historyInstrumentIdentity').classifySavedTasks(db,job.user_id,state);
  // Heartbeat protects a legitimate long backfill from stuck-job recovery.
  const timer = setInterval(() => progress(job.id, state).catch(() => {}), 30000);
  timer.unref?.();
  try {
    await progress(job.id, state);
    // Restarted jobs may carry gaps saved before their listing venue was known.
    // Resolve these in the worker, never in a status/page request.
    const pendingCalendars=state.stage==='portfolio'?[]:state.gaps.filter(g=>!g.unsupported&&g.instrumentType!=='crypto'&&!g.calendar);
    for(let i=0;i<pendingCalendars.length;i++) {
      state.stage='calendars'; state.currentSymbol=pendingCalendars[i].symbol;
      state.calendarProcessed=i; state.calendarTotal=pendingCalendars.length;
      await progress(job.id,state);
      pendingCalendars[i].calendar=await require('./exchangeCalendar').resolve(pendingCalendars[i].symbol,{allowLookup:true,userId:job.user_id});
    }
    state.stage='prices';
    for (let i = state.processed; i < tasks.length; i++) {
      const task = tasks[i];
      state.currentSymbol = task.symbol;
      await progress(job.id, state);
      if(task.unsupported) {
        state.gaps.push({...task,ranges:[]});state.processed=i+1;state.lastProgressAt=new Date().toISOString();await progress(job.id,state);continue;
      }
      try {
        const prices = await require('./portfolioService')._getDailySeries(task.symbol, task.from, task.to, job.user_id, { instrumentType: task.instrumentType });
        task.calendar = task.instrumentType === 'crypto' ? null : await require('./exchangeCalendar').resolve(task.symbol,{allowLookup:true,userId:job.user_id});
        const absent = missingRanges(prices, task.from, task.to, task.instrumentType === 'crypto', task.calendar);
        if (absent.length) state.gaps.push({ ...task, ranges: absent, reason: task.instrumentType === 'crypto' ? 'No finalized broker/provider prices for these dates' : calendarCoverageReason(task.calendar,task.from,task.to) });
        else state.complete++;
      } catch {
        state.gaps.push({ ...task, ranges: [{ from: task.from, to: task.to }], reason: 'History download unavailable; next sync will retry missing dates' });
      }
      state.processed = i + 1; state.lastProgressAt=new Date().toISOString();
      await progress(job.id, state);
    }
    state.stage = 'portfolio'; state.currentSymbol = null;
    await progress(job.id, state);
    // Reconstruction also needs currency/split-aware closes and dated FX.
    // Its corporate-action rules and statement NAV precedence are preserved.
    const maintenance = await require('./brokerPortfolioMaintenance').maintain(job.user_id, { fetchPrices: true, accountIdentifiers:data?.scope ? Object.keys(data.scope.accounts) : null, fromDates:data?.scope?.accounts,
      onProgress:async detail=>{state.portfolioProgress=detail;state.lastProgressAt=new Date().toISOString();await progress(job.id,state);} });
    state.portfolioWarnings = maintenance.warnings;
    await require('./analyticsCache').invalidate(job.user_id);
    state.stage = 'finished';
    await progress(job.id, state);
    return state;
  } finally { clearInterval(timer); }
}
async function status(userId) {
  const rows = (await db.query(`SELECT id,status,result,data,created_at,started_at,completed_at FROM job_queue
    WHERE user_id=$1 AND type=$2 ORDER BY CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,created_at DESC LIMIT 2`, [userId, TYPE])).rows;
  rows.sort((a,b)=>({processing:0,pending:1}[a.status]??2)-({processing:0,pending:1}[b.status]??2)||new Date(b.created_at)-new Date(a.created_at));
  return Promise.all(rows.map(async row => {
    const result = typeof row.result === 'string' ? JSON.parse(row.result) : row.result || {};
    const gaps = await Promise.all((result.gaps || []).map(async gap => {
      if(gap.unsupported || gap.instrumentType === 'crypto') return gap;
      const calendar=gap.calendar || await require('./exchangeCalendar').resolve(gap.symbol);
      const ranges=(gap.ranges || []).flatMap(r => missingRanges([],r.from,r.to,false,calendar));
      return ranges.length ? {...gap,calendar,ranges,reason:calendarCoverageReason(calendar,gap.from||ranges[0]?.from,gap.to||ranges.at(-1)?.to)} : null;
    }));
    const remaining=gaps.filter(Boolean);
    return { id: row.id, status: row.status, stage: result.stage || 'queued', processed: result.processed || 0,
      total: result.total || 0, complete: (result.complete || 0)+(gaps.length-remaining.length), currentSymbol: result.currentSymbol || null,
      lastHeartbeatAt:result.lastHeartbeatAt||row.started_at||null,lastProgressAt:result.lastProgressAt||null,
      portfolioProgress:result.portfolioProgress||null,
      calendarProcessed:result.calendarProcessed||0,calendarTotal:result.calendarTotal||0,
      mode:result.mode||(typeof row.data==='string'?JSON.parse(row.data):row.data)?.mode||null,
      quoteProcessed:result.quoteProcessed||0,quoteTotal:result.quoteTotal||0,
      brokerRows:result.brokerRows||0,quotesRefreshed:result.quotesRefreshed||0,
      gaps: remaining, portfolioWarnings: result.portfolioWarnings || [], createdAt: row.created_at, completedAt: row.completed_at };
  }));
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
module.exports = { mergeScope, enqueue, process, plan, status, addTask, TYPE, claim, start, stop, nudge };
