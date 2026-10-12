// Runs only in a dedicated Node process against TEST. Temporary tables and
// transaction rollback prevent any source trade/account/statement writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const {randomUUID}=require('node:crypto');
const root='/app/backend/src';
function candidate(path,source){const m=new Module(path,module);m.filename=path;m.paths=Module._nodeModulePaths(require('node:path').dirname(path));m._compile(source,path);require.cache[path]=m;return m.exports;}
const planning=candidate(root+'/services/planningLedger.js',CANDIDATE_SOURCES.planningLedger);
const calc=candidate(root+'/services/accountRealisedPnl.js',CANDIDATE_SOURCES.calculation).calculateAccountResult;
const db=require(root+'/config/database');
const User=require(root+'/models/User');
let group=false;User.getSettings=async()=>({analytics_position_grouping:group,analytics_breakeven_mode:'exact',display_currency:'GBP'});
require(root+'/utils/timezone').getUserTimezone=async()=> 'UTC';
const fx=candidate(root+'/utils/tradeFx.js',CANDIDATE_SOURCES.tradeFx);
// Temporary functions require explicit qualification in PostgreSQL.
const actualFxSql=fx.fxUsd;fx.fxUsd=(...args)=>actualFxSql(...args).replaceAll('trade_account_report_usd(', 'pg_temp.trade_account_report_usd(');
candidate(root+'/utils/executionPnlByDate.js',CANDIDATE_SOURCES.events);
const rates={USD:1,GBP:.8,EUR:.9};fx.getUsdRateMap=async()=>rates;
require(root+'/utils/currencyConverter').getDailyCrossRate=async(from,to)=>from===to?1:rates[to]/rates[from];
const display=candidate(root+'/utils/displayCurrency.js',CANDIDATE_SOURCES.display).convertForDisplay;
let querySource=CANDIDATE_SOURCES.queries;
const Queries=candidate(root+'/services/tradeQueries.account-test.js',querySource);
const fill=(action,q,p,rate,time)=>({action,quantity:q,price:p,datetime:time,account_currency:'GBP',broker_fx_rate:rate,commission:0,fees:0});
async function main(){
 const client=await db.connect();const query=client.query.bind(client);db.query=query;let checks=0;
 try{
  assert.equal((await query('SELECT current_database() AS name')).rows[0].name,'tradetally_test','Only TEST is permitted');
  await query('BEGIN');await query('SET LOCAL search_path=pg_temp,public');
  await query('CREATE TEMP TABLE trades AS SELECT * FROM public.trades WITH NO DATA');
  await query('CREATE TEMP TABLE trade_account_reports(trade_id UUID PRIMARY KEY,user_id UUID,result JSONB)');
  await query('CREATE TEMP TABLE fx_daily_rates(base_code TEXT,rate_date DATE,rates JSONB)');
  await query(`INSERT INTO fx_daily_rates VALUES('USD',CURRENT_DATE,'{"USD":1,"GBP":0.8,"EUR":0.9}')`);
  await query(`CREATE FUNCTION pg_temp.trade_account_report_usd(trade_key UUID,field TEXT) RETURNS NUMERIC LANGUAGE sql STABLE AS $$ SELECT CASE WHEN result->>'currency'='USD' THEN (result->>field)::numeric ELSE (result->>field)::numeric / NULLIF((SELECT (rates->>(result->>'currency'))::numeric FROM fx_daily_rates WHERE base_code='USD' LIMIT 1),0) END FROM trade_account_reports WHERE trade_id=trade_key $$`);
  const user=randomUUID(),id=randomUUID();
  const executions=[fill('buy',10,100,1.25,'2026-01-01T10:00:00Z'),fill('sell',4,120,1.2,'2026-01-02T10:00:00Z'),fill('sell',6,130,1.3,'2026-01-03T10:00:00Z')];
  const trade={id,side:'long',instrument_type:'stock',original_currency:'USD',quantity:10,entry_price:100,exit_price:126,pnl:260,commission:0,fees:0,executions};
  const result=calc(trade,'GBP');assert.equal(result.pnl,200);checks++;
  await query(`INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,side,instrument_type,original_currency,pnl,commission,fees,executions,account_identifier) VALUES($1,$2,'SYNTHETIC','2026-01-01','2026-01-01T10:00:00Z','2026-01-03T10:00:00Z',100,126,10,'long','stock','USD',260,0,0,$3::jsonb,'gbp')`,[id,user,JSON.stringify(executions)]);
  await query('INSERT INTO trade_account_reports VALUES($1,$2,$3::jsonb)',[id,user,JSON.stringify(result)]);
  const allocations=planning.sourceFills(trade).map((f,i)=>({id:String(i),trade_id:id,action:f.action,quantity:f.quantity,stage_key:'s'+i,source_key:f.key,source_snapshot:f}));
  const plan={definition:{instrument:'stock',direction:'long',currency:'USD',stopPrice:90},management:{}};
  assert.equal(planning.ledger(plan,allocations,[trade]).accountRealisedProfit,200);checks++;
  const row=await display({user:{id:user},accountReports:new Map([[id,result]])},{trade},{rowCurrency:true});assert.equal(row.trade.pnl,200);assert.equal(row.trade.account_pnl_result.pnl,200);checks++;
  const summary=(await query(`SELECT SUM(${fx.fxUsd('pnl')}) AS pnl FROM trades t WHERE user_id=$1`,[user])).rows[0];assert.equal(Number(summary.pnl)*.8,200);checks++;
  for(const grouped of [false,true]){
   group=grouped;const analytics=await Queries.getAnalytics(user,{accounts:['gbp']});
   assert.equal(Number(analytics.summary.totalPnL)*.8,200);checks++;
   assert.equal(analytics.summary.totalRValue,null,'Missing risk must not report a valid zero R');checks++;
   const daily=analytics.dailyPnL||[];
   assert.ok(daily.length>=2,'Actual dashboard exit-event series must include both exit dates');
   assert.ok(Math.abs(daily.reduce((s,d)=>s+Number(d.daily_pnl||0),0)*.8-200)<1e-8);checks++;
  }
  await query(`UPDATE fx_daily_rates SET rates='{"USD":1,"GBP":0.7,"EUR":0.85}'`);
  const next=(await query(`SELECT SUM(${fx.fxUsd('pnl')}) AS pnl FROM trades t WHERE user_id=$1`,[user])).rows[0];assert.ok(Math.abs(Number(next.pnl)*.7-200)<1e-8);checks++;
  console.log(JSON.stringify({isolatedChecks:checks,sourceWrites:false,rollback:true}));
 }finally{await query('ROLLBACK');client.release();await db.pool.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
