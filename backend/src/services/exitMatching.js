const crypto = require('crypto');
const db = require('../config/database');
const { computeTradePnl } = require('./pnlEngine');
const AnalyticsCache = require('./analyticsCache');
const list = row => typeof row.executions === 'string' ? JSON.parse(row.executions) : row.executions || [];
const version = row => crypto.createHash('sha256').update(JSON.stringify(list(row))).digest('hex');
function fail(message, status = 409) { throw Object.assign(new Error(message), { status }); }
function supported(row) {
 // Trading 212 uses explicit fills and a complete-history reconciler. Other
 // adapters need the same baseline-preserving integration before enabling edits.
 return Boolean(row.account_identifier) && /^[A-Z]{3}$/.test(row.original_currency||'') && row.broker === 'trading212' && row.instrument_type === 'stock' && row.side === 'long'
  && list(row).length > 0 && list(row).every(e => ['buy','sell'].includes(e.action)
   && Number(e.quantity)>0 && Number(e.price)>0 && Number.isFinite(Date.parse(e.datetime)));
}
function compatible(a,b) {
 return a.symbol === b.symbol && a.side === b.side && a.broker === b.broker
  && a.account_identifier === b.account_identifier && a.broker_connection_id === b.broker_connection_id
  && a.instrument_type === b.instrument_type && a.original_currency === b.original_currency;
}
function validatePosition(row, fills) {
 let quantity=0;
 for(const e of [...fills].sort((a,b)=>Date.parse(a.datetime)-Date.parse(b.datetime))) {
  quantity += (e.action === 'buy' ? 1 : -1)*Number(e.quantity);
  if(quantity < -1e-8) fail('This exit exceeds the shares held at its execution time');
 }
 if(!fills.some(e=>e.action==='buy')) fail('The opening execution must remain on the trade');
 return quantity;
}
async function owned(client,user,id) {
 const row=(await client.query('SELECT * FROM trades WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user])).rows[0];
 if(!row)fail('Trade not found',404);
 if(!supported(row))fail('Exit correction is currently supported for Trading 212 share executions',400);
 return row;
}
async function unlockedExit(client,user,row,execution) {
 const {sourceFills}=require('./planningLedger');
 const fill=sourceFills({...row,executions:[execution]}).find(f=>f.action==='exit');
 if(!fill)fail('Unable to identify this closing execution safely');
 const used=await client.query(`SELECT 1 FROM trade_plan_allocations
  WHERE user_id=$1 AND trade_id=$2 AND source_key=$3 AND action='exit' LIMIT 1`,[user,row.id,fill.key]);
 if(used.rows.length)fail('Unlink this sell from its plan exit before detaching it. The buy can stay linked.');
}
async function save(client,row,fills,timezone) {
 validatePosition(row,fills);
 const {aggregate:a,annotatedExecutions}=computeTradePnl({side:row.side,instrumentType:row.instrument_type,executions:fills,timezone});
 const risk=row.stop_loss==null?0:Math.abs(a.entry_price-Number(row.stop_loss))*a.quantity;
 await client.query(`UPDATE trades SET matching_baseline=COALESCE(matching_baseline,executions),
  executions=$3::jsonb,entry_price=$4,exit_price=$5,entry_time=$6,exit_time=$7,trade_date=$8,
  quantity=$9,commission=$10,fees=$11,pnl=$12,pnl_percent=$13,r_value=$14,updated_at=NOW()
  WHERE id=$1 AND user_id=$2`,[row.id,row.user_id,JSON.stringify(annotatedExecutions),a.entry_price,
  a.exit_price,a.entry_time,a.exit_time,a.trade_date,a.quantity,a.commission,a.fees,a.pnl,a.pnl_percent,
  risk>0&&a.pnl!=null?a.pnl/risk:null]);
}
function checkVersion(row, expected) {
 if(expected!==version(row))fail('Executions changed; refresh the trade and try again');
}
async function correct(user,targetId,request) {
 const reason='Incorrectly matched exit';
 const result=await db.withTransaction(async client=>{
  // Shares the sync lock and serialises edits on the same connection.
  const meta=(await client.query('SELECT broker_connection_id FROM trades WHERE id=$1 AND user_id=$2',[targetId,user])).rows[0];
  if(!meta)fail('Trade not found',404);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[meta.broker_connection_id||user]);
  const target=await owned(client,user,targetId);
  checkVersion(target,request.version);
  const timezone=(await client.query('SELECT timezone FROM users WHERE id=$1',[user])).rows[0].timezone;
  let record, from=null;
  if(request.operation==='detach') {
   const fills=list(target), index=request.index;
   if(!Number.isInteger(index)||fills[index]?.action!=='sell')fail('Choose a closing sell execution',400);
   const execution=fills[index];
   await unlockedExit(client,user,target,execution);
   const existing=(await client.query(`SELECT * FROM detached_trade_exits WHERE user_id=$1 AND assigned_trade_id=$2 FOR UPDATE`,[user,target.id])).rows;
   record=existing.find(r=>executionSignature(r.execution)===executionSignature(execution));
   if(record) await client.query('UPDATE detached_trade_exits SET assigned_trade_id=NULL,reason=$2,updated_at=NOW() WHERE id=$1',[record.id,reason]);
   else record=(await client.query(`INSERT INTO detached_trade_exits(user_id,origin_trade_id,execution,reason)
    VALUES($1,$2,$3::jsonb,$4) RETURNING *`,[user,target.id,JSON.stringify(execution),reason])).rows[0];
   await save(client,target,fills.filter((_,i)=>i!==index),timezone);
   from=target.id;
  } else if(request.operation==='attach') {
   record=(await client.query('SELECT * FROM detached_trade_exits WHERE id=$1 AND user_id=$2 FOR UPDATE',[request.exitId,user])).rows[0];
   if(!record||record.assigned_trade_id)fail('Exit is no longer available; refresh and try again');
   const origin=await owned(client,user,record.origin_trade_id);
   if(!compatible(origin,target))fail('Exit instrument, account or currency does not match this trade');
   const fills=list(target);
   if(fills.some(e=>executionSignature(e)===executionSignature(record.execution)))fail('This exit is already on the trade');
   await save(client,target,[...fills,record.execution],timezone);
   await client.query('UPDATE detached_trade_exits SET assigned_trade_id=$2,reason=$3,updated_at=NOW() WHERE id=$1',[record.id,target.id,reason]);
  } else fail('Unknown exit correction action',400);
  await client.query(`INSERT INTO trade_exit_matching_history(user_id,exit_id,from_trade_id,to_trade_id,reason)
   VALUES($1,$2,$3,$4,$5)`,[user,record.id,from,request.operation==='attach'?target.id:null,reason]);
  await client.query('DELETE FROM analytics_cache WHERE user_id=$1',[user]);
  return {exitId:record.id};
 });
 await AnalyticsCache.invalidate(user);
 return result;
}
// Broker identity + financial evidence; derived P&L annotations are excluded.
function executionSignature(e) {
 return JSON.stringify([e.action,e.type,e.order_id??e.orderId??null,Number(e.quantity),Number(e.price),
  new Date(e.datetime).toISOString(),Number(e.commission||0),Number(e.fees||0),e.currency||null]);
}
async function state(user,id) {
 const row=(await db.query('SELECT * FROM trades WHERE id=$1 AND user_id=$2',[id,user])).rows[0];
 if(!row)fail('Trade not found',404);
 if(!supported(row))return {supported:false};
 const candidates=(await db.query(`SELECT d.*,t.symbol,t.side,t.broker,t.account_identifier,t.broker_connection_id,
  t.instrument_type,t.original_currency FROM detached_trade_exits d JOIN trades t ON t.id=d.origin_trade_id
  WHERE d.user_id=$1 AND d.assigned_trade_id IS NULL ORDER BY d.created_at DESC`,[user])).rows.filter(r=>compatible(row,r));
 const history=(await db.query(`SELECT h.reason,h.created_at,h.from_trade_id,h.to_trade_id
  FROM trade_exit_matching_history h WHERE h.user_id=$1 AND (h.from_trade_id=$2 OR h.to_trade_id=$2)
  ORDER BY h.created_at DESC LIMIT 10`,[user,id])).rows;
 return {supported:true,version:version(row),exits:list(row).map((e,index)=>({...e,index})).filter(e=>e.action==='sell'),
  available:candidates.map(r=>({id:r.id,execution:r.execution,originTradeId:r.origin_trade_id})),history};
}
// Match the unmodified broker grouping first, then replay saved corrections.
// Changed source evidence is explicitly rejected rather than silently resetting
// the owner's decision or manufacturing/duplicating executions.
function preserveCorrections(desired,existing) {
 const adjusted=desired.map(t=>({...t}));
 const reserved=new Set();
 for(const old of existing.filter(r=>r.matching_baseline)) {
  const baseline=typeof old.matching_baseline==='string'?JSON.parse(old.matching_baseline):old.matching_baseline;
  const signature=baseline.map(executionSignature).sort().join('|');
  const index=adjusted.findIndex((t,i)=>!reserved.has(i)&&t.symbol===old.symbol&&t.side===old.side
   &&(t.executionData||t.executions||[]).map(executionSignature).sort().join('|')===signature);
  if(index<0)fail('Broker execution evidence changed for a manually matched trade; review the exit correction before reconciling');
  reserved.add(index);
  adjusted[index]={...adjusted[index],executionData:list(old),matchingTradeId:old.id};
 }
 return adjusted;
}
module.exports={state,correct,list,version,supported,compatible,validatePosition,executionSignature,preserveCorrections};
