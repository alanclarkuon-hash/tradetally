const crypto = require('crypto');
const {dateOnly} = require('./planningJournal');
const {sourceFills} = require('./planningLedger');
const {accountIds} = require('./planningAccounts');
const {fail} = require('./tradePlanning');
const EPS = 1e-8;
const executions = trade => typeof trade.executions === 'string' ? JSON.parse(trade.executions) : trade.executions || [];
const positionIds = trade => [...new Set(executions(trade).map(e => e.etoro_position_id).filter(v => v != null).map(String))];
function category(event) {
 if (event.event_type === 'dividend') return 'dividend';
 if (event.event_type === 'tax' && /withhold|dividend/i.test(event.description || '')) return 'withholding';
 if (['account_fee','interest'].includes(event.event_type) && /overnight|weekend refund|funding|financing|borrow|margin interest|interest for|debit interest|broker interest paid/i.test(event.description || '')) return 'financing';
 return null;
}
function snapshot(event, source = null) {
 return {id:event.id,accountId:event.account_id,broker:event.broker_type,reference:event.reference_id,date:dateOnly(event.event_date),amount:Number(event.amount),currency:event.currency,amountUSD:Number(event.amount_usd),description:event.description || '',category:category(event),metadata:event.metadata || {},source};
}
const fingerprint = s => crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');
function closedTreatment(event, source, trades, cash) {
 const own = trades.filter(t => t.broker === event.broker_type);
 if (event.broker_type === 'ig' && category(event) === 'financing' && own.length && own.every(t => t.instrument_type === 'spread_bet' && t.exit_time && executions(t).some(e => e.ig_file_source))) {
  return 'already_included'; // IG importer explicitly includes funding/borrowing in settled P/L.
 }
 if (event.broker_type !== 'etoro' || !source?.positionId) return null;
 const matches = own.filter(t => positionIds(t).includes(String(source.positionId)));
 if (matches.length !== 1) return null;
 if (!matches[0].exit_time && Number(matches[0].fees||0)===0) return 'include';
 if (!matches[0].exit_time || matches[0].pnl == null) return null;
 const t = matches[0], fills = sourceFills(t), exits = fills.filter(f => f.action === 'exit');
 if (exits.length !== 1 || exits[0].brokerLeverage !== 1 || exits[0].brokerReportedNet == null) return null;
 const gross = (Number(t.exit_price)-Number(t.entry_price))*Number(t.quantity)*(t.side==='short'?-1:1)-Number(t.commission||0);
 const adjustment = Number(t.pnl)-gross;
 const related = cash.filter(e => e.source?.positionId === source.positionId && ['dividend','financing'].includes(e.snapshot.category));
 const sum = kind => related.filter(e => !kind || e.snapshot.category === kind).reduce((v,e)=>v+e.snapshot.amount,0);
 const same = n => Math.abs(adjustment-n)<=.005;
 if (Math.abs(adjustment)<=.005) return 'include';
 if (same(sum()) || same(sum(category(event)))) return 'already_included';
 const other = category(event)==='dividend'?'financing':'dividend';
 if (same(sum(other))) return 'include';
 return null; // Rounded prices or unexplained adjustments do not prove fee treatment.
}
function embeddedFraction(event, source, trades, cash, records, originalQuantity) {
 if (event.broker_type!=='etoro' || !source?.positionId || !(originalQuantity>0)) return null;
 let fraction=0;
 const time=source.time || dateOnly(event.event_date)+'T00:00:00Z';
 for (const t of trades.filter(t=>positionIds(t).includes(String(source.positionId)) && t.exit_time)) {
  if (new Date(time)>new Date(t.exit_time)) continue;
  const fills=sourceFills(t),exit=fills.filter(f=>f.action==='exit');
  if (exit.length!==1 || exit[0].brokerLeverage!==1 || t.pnl==null) return null;
  const adjustment=Number(t.pnl)-(Number(t.exit_price)-Number(t.entry_price))*Number(t.quantity)*(t.side==='short'?-1:1)+Number(t.commission||0);
  if (Math.abs(adjustment)<=.005) continue;
  const related=cash.filter(e=>e.source?.positionId===source.positionId && new Date(e.source.time||e.snapshot.date+'T00:00:00Z')<=new Date(t.exit_time));
  const sum=kind=>related.filter(e=>!kind || e.snapshot.category===kind).reduce((v,e)=>v+e.snapshot.amount,0);
  const scale=Number(t.quantity)/originalQuantity, same=n=>Math.abs(adjustment-n*scale)<=.005;
  const kind=category(event),other=kind==='dividend'?'financing':'dividend';
  if (same(sum()) || same(sum(kind))) {
   fraction+=records.filter(r=>r.trade_id===t.id&&r.action==='exit'&&r.valid).reduce((v,r)=>v+r.quantity,0)/originalQuantity;
  } else if (!same(sum(other))) return null;
 }
 return Math.min(1,fraction);
}
function autoFraction(event, source, trades, records, originalQuantity) {
 if (event.broker_type !== 'etoro' || !source?.positionId) return null;
 const matches = trades.filter(t => positionIds(t).includes(String(source.positionId)));
 if (matches.length !== 1) return null;
 const t = matches[0], entry = sourceFills(t).filter(f => f.action==='entry');
 if (!(originalQuantity>0) || Math.abs(Number(t.quantity)-originalQuantity)>EPS) return null;
 const actual = records.filter(r=>r.trade_id===t.id && r.action==='entry' && r.valid && !r.fill.provisional);
 if (!entry.length || entry.some(f => Math.abs(actual.filter(r=>r.source_key===f.key).reduce((v,r)=>v+r.quantity,0)-f.quantity)>EPS)) return null;
 // Exact position identity still needs dated exposure. Late dividend entitlement
 // and partially attributed positions require an explicit confirmation.
 const time = source.time || dateOnly(event.event_date)+'T23:59:59Z';
 const held = records.filter(r=>r.trade_id===t.id && r.valid && !r.fill.provisional && r.fill.time<=time).reduce((v,r)=>v+(r.action==='entry'?r.quantity:-r.quantity),0);
 return held>EPS ? 1 : null;
}
async function historicalAmount(c, s, currency, cache) {
 if (s.currency===currency) return s.amount;
 if (s.source?.currency===currency && s.source.amount!=null && Number.isFinite(Number(s.source.amount))) return Number(s.source.amount);
 if (currency==='USD') return Number.isFinite(s.amountUSD)?s.amountUSD:null;
 const brokerRate=Number(s.metadata?.fxRateToBase);
 if (s.metadata?.baseCurrency===currency && brokerRate>0) return s.amount*brokerRate;
 const key=s.date+'|'+currency;
 if (!cache.has(key)) {
  const row=(await c.query("SELECT rates,rate_date FROM fx_daily_rates WHERE base_code='USD' AND rate_date<=$1::date ORDER BY rate_date DESC LIMIT 1",[s.date])).rows[0];
  cache.set(key,row?.rates?.[currency]>0?Number(row.rates[currency]):null);
 }
 const rate=cache.get(key);
 return rate && Number.isFinite(s.amountUSD)?s.amountUSD*rate:null;
}
async function load(c, plan, result, trades) {
 const ids=accountIds(plan.definition);
 if (!ids.length || !result.records.some(r=>r.action==='entry'&&!r.fill.provisional)) return {entries:[],candidates:[],unresolved:0,pending:0};
 const first=result.records.filter(r=>r.action==='entry'&&!r.fill.provisional).map(r=>r.fill.time.slice(0,10)).sort()[0];
 const accounts=(await c.query('SELECT id,currency,broker FROM user_accounts WHERE user_id=$1 AND id=ANY($2::uuid[])',[plan.user_id,ids])).rows;
 const links=(await c.query('SELECT * FROM trade_plan_cashflow_links WHERE user_id=$1 AND plan_id=$2',[plan.user_id,plan.id])).rows;
 const events=(await c.query("SELECT * FROM broker_cash_events WHERE user_id=$1 AND account_id=ANY($2::uuid[]) AND (event_date>=$3::date OR id=ANY($4::uuid[])) AND event_type IN ('dividend','account_fee','interest','tax') ORDER BY event_date,id",[plan.user_id,ids,first,links.map(l=>l.cash_event_id).filter(Boolean)])).rows.filter(e=>category(e));
 const pids=[...new Set(trades.flatMap(positionIds))], refs=[...new Set([...events.filter(e=>e.broker_type!=='etoro').map(e=>e.reference_id),...links.map(l=>l.source_snapshot.reference)])];
 const sources=(await c.query("SELECT r.account_id,r.currency,e AS record FROM broker_cash_reports r CROSS JOIN LATERAL jsonb_array_elements(r.records) e WHERE r.user_id=$1 AND r.account_id=ANY($2::uuid[]) AND (e->>'positionId'=ANY($3::text[]) OR e->>'reference'=ANY($4::text[])) ORDER BY r.updated_at DESC",[plan.user_id,ids,pids,refs])).rows;
 const map=new Map(),conflicts=new Set(),originalQuantities=new Map();
 for (const r of sources) {
  if (r.record.sourceType==='Open Position' && r.record.positionId && Number(r.record.units)>0) originalQuantities.set(r.account_id+'|'+r.record.positionId,Math.max(originalQuantities.get(r.account_id+'|'+r.record.positionId)||0,Number(r.record.units)));
  const key=r.account_id+'|'+r.record.reference,previous=map.get(key);
  // Identical overlapping reports are one cash movement, never two payments.
  const relevant={positionId:r.record.positionId||null,symbol:r.record.symbol||null,time:r.record.time||null,amount:r.record.amount,currency:r.currency,sourceType:r.record.sourceType||r.record.code||r.record.type||null};
  if (previous && JSON.stringify(previous)!==JSON.stringify(relevant)) conflicts.add(key);
  if (!previous) map.set(key,relevant);
 }
 const aliases=new Set([plan.definition.symbol,...trades.map(t=>t.symbol)].filter(Boolean).map(v=>v.toUpperCase()));
 const cash=events.map(e=>{const source=map.get(e.account_id+'|'+e.reference_id)||null;return {event:e,source,snapshot:snapshot(e,source)}});
 const otherLinks=(await c.query("SELECT plan_id,cash_event_id,fraction,treatment FROM trade_plan_cashflow_links WHERE user_id=$1 AND plan_id<>$2 AND treatment<>'exclude' AND cash_event_id=ANY($3::uuid[])",[plan.user_id,plan.id,events.map(e=>e.id)])).rows;
 const otherSourceEntries=(await c.query("SELECT a.plan_id,t.executions FROM trade_plan_allocations a JOIN trades t ON t.id=a.trade_id AND t.user_id=a.user_id WHERE a.user_id=$1 AND a.plan_id<>$2 AND a.action='entry' AND t.broker='etoro'",[plan.user_id,plan.id])).rows;
 const sharedPositions=new Set(otherSourceEntries.flatMap(positionIds));
 const entries=[],candidates=[],cache=new Map();
 for (const x of cash) {
  const e=x.event,s=x.snapshot,link=links.find(l=>l.cash_event_id===e.id),sourceMatch=x.source?.positionId&&pids.includes(String(x.source.positionId));
  const tokens=(x.source?.symbol||e.metadata?.symbol||e.description||'').toUpperCase().split(/[^A-Z0-9._-]+/);
  const assetMatch=tokens.some(t=>aliases.has(t)||[...aliases].some(a=>t.startsWith(a+'_')));
  if (!link && e.broker_type==='etoro' && !sourceMatch) continue;
  if (!link && x.source?.symbol && !assetMatch && !sourceMatch) continue;
  const ownTrades=trades.filter(t=>result.records.some(r=>r.trade_id===t.id&&r.accountId===e.account_id));
  const embedded=embeddedFraction(e,x.source,ownTrades,cash,result.records,originalQuantities.get(e.account_id+'|'+x.source?.positionId));
  const proof=embedded!=null?(embedded>=1-EPS?'already_included':'include'):closedTreatment(e,x.source,ownTrades,cash);
  const automatic=sourceMatch&&!sharedPositions.has(String(x.source.positionId))&&!conflicts.has(e.account_id+'|'+e.reference_id)?autoFraction(e,x.source,ownTrades,result.records,originalQuantities.get(e.account_id+'|'+x.source.positionId)):null;
  const used=otherLinks.filter(l=>l.cash_event_id===e.id).reduce((v,l)=>v+Number(l.fraction),0);
  let treatment=link?.treatment || (automatic && used===0 && proof ? proof : 'pending');
  if (treatment==='include' && proof==='already_included') treatment='already_included';
  const fraction=link?Number(link.fraction):automatic||1;
  const sourceVerified=!conflicts.has(e.account_id+'|'+e.reference_id)&&(!x.source||x.source.currency!==s.currency||Math.abs(Number(x.source.amount)-s.amount)<EPS);
  const valid=sourceVerified&&(!link || fingerprint(s)===link.source_snapshot.fingerprint)&&fraction+used<=1+EPS;
  const account=accounts.find(a=>a.id===e.account_id),accountAmount=await historicalAmount(c,s,account?.currency,cache),instrumentAmount=await historicalAmount(c,s,result.currency||plan.definition.currency,cache);
  const effectiveFraction=treatment==='include'?Math.max(0,fraction-(embedded||0)):0;
  const status=!valid?'source_changed':treatment==='include'&&(accountAmount==null||instrumentAmount==null)?'fx_missing':treatment;
  const row={id:e.id,linkId:link?.id||null,accountId:e.account_id,date:s.date,description:s.description,category:s.category,amount:s.amount,currency:s.currency,fraction,effectiveFraction,sourceVerified,embeddedFraction:embedded||0,treatment,status,automatic:!link&&automatic===1&&treatment!=='pending',likely:!!sourceMatch||assetMatch,availableFraction:Math.max(0,1-used),fingerprint:fingerprint(s),source:s,accountCurrency:account?.currency,accountAmount,instrumentAmount,reason:link?.reason||'',includedProof:proof==='already_included'};
  candidates.push(row);
  if (link || row.automatic) entries.push(row);
 }
 for (const l of links.filter(l=>!events.some(e=>e.id===l.cash_event_id))) entries.push({id:l.cash_event_id,linkId:l.id,accountId:l.source_snapshot.accountId,date:l.source_snapshot.date,description:l.source_snapshot.description,category:l.source_snapshot.category,amount:l.source_snapshot.amount,currency:l.source_snapshot.currency,fraction:Number(l.fraction),treatment:l.treatment,status:'source_changed',reason:l.reason});
 return {entries,candidates,currency:result.currency||plan.definition.currency,unresolved:entries.filter(e=>['source_changed','fx_missing'].includes(e.status)).length,pending:candidates.filter(e=>e.likely&&e.status==='pending').length};
}
function apply(result, cashflows) {
 const applied=cashflows.entries.filter(e=>e.status==='include'), sum=(rows,key)=>rows.reduce((v,e)=>v+e[key]*e.fraction,0);
 const additional=applied.map(e=>({...e,fraction:e.effectiveFraction??e.fraction}));
 const instrument=sum(additional,'instrumentAmount');
 const accounts=(result.accounts||[]).map(a=>{const delta=sum(additional.filter(e=>e.accountId===a.accountId),'accountAmount');return {...a,tradeRealisedProfit:a.realisedProfit,cashflowProfit:delta,realisedProfit:cashflows.unresolved||a.realisedProfit==null?null:a.realisedProfit+delta,maximumLoss:a.maximumLoss==null?null:Math.max(0,a.maximumLoss-delta)}});
 const nativeReady=result.accountCurrency&&applied.every(e=>e.accountCurrency===result.accountCurrency),native=nativeReady?sum(additional,'accountAmount'):0;
 const profit=cashflows.unresolved||result.realisedProfit==null?null:result.realisedProfit+instrument,accountProfit=cashflows.unresolved||result.accountRealisedProfit==null?null:result.accountRealisedProfit+native;
 return {...result,accounts,cashflows,tradeRealisedProfit:result.realisedProfit,accountTradeRealisedProfit:result.accountRealisedProfit,cashflowCurrency:cashflows.currency,cashflowProfit:instrument,accountCashflowProfit:native,realisedProfit:profit,accountRealisedProfit:accountProfit,percentGain:profit!=null&&result.entryCost>0?profit/result.entryCost*100:null,accountPercentGain:accountProfit!=null&&result.accountEntryCost>0?accountProfit/result.accountEntryCost*100:null,realisedR:result.realisedR==null?null:profit/result.originalRisk,accountRealisedR:accountProfit!=null&&result.accountOriginalRisk>0?accountProfit/result.accountOriginalRisk:null,maximumLoss:result.maximumLoss==null?null:Math.max(0,result.maximumLoss-instrument)};
}
async function enrich(c,plan,result,trades) {return apply(result,await load(c,plan,result,trades))}
async function save(c,plan,result,trades,input) {
 const data=await load(c,plan,result,trades),event=data.candidates.find(e=>e.id===input.cashEventId);
 if (!event || event.fingerprint!==input.fingerprint || !event.sourceVerified) fail('Cashflow source changed or is not available for these plan accounts',409);
 if (input.treatment==='include' && event.includedProof) fail('This charge is already included in settled broker profit; do not deduct it again');
 if (input.treatment!=='exclude' && input.fraction>event.availableFraction+EPS) fail('Cashflow allocation exceeds its unallocated amount',409);
 if (input.treatment==='include' && (event.accountAmount==null||event.instrumentAmount==null)) fail('Stored transaction-date cashflow FX is unavailable');
 await c.query('INSERT INTO trade_plan_cashflow_links(user_id,plan_id,cash_event_id,source_key,fraction,treatment,reason,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(user_id,plan_id,source_key) DO UPDATE SET cash_event_id=EXCLUDED.cash_event_id,fraction=EXCLUDED.fraction,treatment=EXCLUDED.treatment,reason=EXCLUDED.reason,source_snapshot=EXCLUDED.source_snapshot,updated_at=NOW()', [plan.user_id,plan.id,event.id,event.id,input.fraction,input.treatment,input.reason,JSON.stringify({...event.source,fingerprint:event.fingerprint})]);
 return {...input,source:event.source};
}
module.exports={category,snapshot,fingerprint,closedTreatment,embeddedFraction,autoFraction,historicalAmount,load,apply,enrich,save};
