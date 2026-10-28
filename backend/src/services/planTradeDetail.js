const db=require('../config/database');
const {ledger}=require('./planningLedger');
const {fail}=require('./tradePlanning');
const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Read-only projection of the plan's explicit allocations. Broker pairing remains
// source evidence, not the position boundary of this trade detail response.
function projectPlanTrade(source,plan,result,fx=null) {
 result=require('./planningReporting').project(result,plan.definition,fx);
 if(result.unresolved||result.overExit||(!result.coverageComplete&&!result.costsUnresolved)||result.provisionalCount||!result.currency)fail('Reconcile the plan trade links before opening the combined trade',409);
 const records=result.records.filter(r=>!r.fill.provisional);
 const groups=new Map();
 for(const r of records){
  const f=r.fill,key=JSON.stringify([r.action,r.stage_key,f.time,f.price,f.currency,f.multiplier,f.contract,f.transactionFx?.accountCurrency,f.transactionFx?.rate,f.displaySource?.currency,f.displaySource?.price]);
  if(!groups.has(key))groups.set(key,{id:'plan:'+r.id,action:r.action==='entry'?(f.tradeSide==='short'?'sell':'buy'):(f.tradeSide==='short'?'buy':'sell'),quantity:0,price:f.price,datetime:f.time,commission:0,fees:0,realized_pnl:r.action==='exit'?0:null,accountProfit:r.action==='exit'?0:null,stage_key:r.stage_key,source_trade_ids:[],source_price:f.displaySource?.price,source_price_currency:f.displaySource?.currency,broker_fx_rate:(f.displaySource?.transactionFx||f.transactionFx)?.rate,account_currency:(f.displaySource?.transactionFx||f.transactionFx)?.accountCurrency});
  const e=groups.get(key),portion=r.quantity/f.quantity;
  e.quantity+=r.quantity;e.commission+=Number(f.commission||0)*portion;e.fees+=Number(f.netFees??f.fees??0)*portion;
  if(r.action==='exit'){if(r.realisedProfit==null)e.realized_pnl=null;else if(e.realized_pnl!=null)e.realized_pnl+=r.realisedProfit;if(r.accountRealisedProfit==null)e.accountProfit=null;else if(e.accountProfit!=null)e.accountProfit+=r.accountRealisedProfit;}
  if(!e.source_trade_ids.includes(r.trade_id))e.source_trade_ids.push(r.trade_id);
 }
 const executions=[...groups.values()].sort((a,b)=>a.datetime.localeCompare(b.datetime));
 const entries=records.filter(r=>r.action==='entry'),exits=records.filter(r=>r.action==='exit');
 const average=rows=>rows.length?rows.reduce((sum,r)=>sum+r.quantity*r.fill.price,0)/rows.reduce((sum,r)=>sum+r.quantity,0):null;
 const accountComplete=result.accountRealisedProfit!=null;
 const closed=result.economicallyClosed||(!result.unresolved&&!result.overExit&&!result.provisionalCount&&Math.abs(result.openQuantity)<1e-8);
 const evidenceWarning=result.costsUnresolved?'Linked quantities and prices are verified. Broker costs are not fully assigned to these fills, so realised profit is unavailable.':null;
 const costs=records.reduce((sum,r)=>sum+(r.fill.netCosts??r.fill.costs)*r.quantity/r.fill.quantity,0);
 const commission=records.reduce((sum,r)=>sum+Number(r.fill.commission||0)*r.quantity/r.fill.quantity/(r.fill.transactionFx?.rate||1),0);
 const fees=records.reduce((sum,r)=>sum+Number(r.fill.netFees??r.fill.fees??0)*r.quantity/r.fill.quantity/(r.fill.transactionFx?.rate||1),0);
 const report={status:accountComplete?'complete':'unavailable',basis:'plan_allocations',currency:result.accountCurrency,pnl:result.accountRealisedProfit,entryCost:result.accountEntryCost,commission,fees,
  events:executions.flatMap((e,index)=>e.realized_pnl==null||e.accountProfit==null?[]:[{sourceIndex:index,pnl:e.accountProfit,gross_pnl:e.accountProfit,time:e.datetime}])};
 // The plan's asset is the market-data identity; the broker key stays on the
 // original record and source metadata. Options retain their contract symbol.
 const trade={...source,symbol:plan.definition.instrument==='option'?source.symbol:(plan.definition.symbol||source.symbol),underlying_symbol:plan.definition.symbol||source.underlying_symbol,plan_trade:{displayConversion:!!result.displayConversion,sourceSymbol:source.symbol,id:plan.id,title:plan.definition.title,sourceTradeId:source.id,evidenceWarning,cashflows:result.cashflows,tradeRealisedProfit:result.tradeRealisedProfit,sourceTradeIds:[...new Set(records.map(r=>r.trade_id))]},
  executions,quantity:result.entered,price:average(entries),entry_price:average(entries),exit_price:closed?average(exits):null,entry_time:entries[0]?.fill.time,exit_time:closed?exits.at(-1)?.fill.time:null,
  trade_date:entries[0]?.fill.time,pnl:result.realisedProfit,gross_pnl:result.realisedProfit==null?null:result.realisedProfit+costs,open_average_price:result.averagePrice,pnl_percent:result.percentGain,r_value:result.realisedR,commission:executions.reduce((s,e)=>s+e.commission,0),fees:executions.reduce((s,e)=>s+e.fees,0),
  original_currency:result.currency,original_entry_price_currency:null,original_exit_price_currency:null,original_pnl_currency:null,exchange_rate:null,native_prices:null,account_currency:result.accountCurrency,account_pnl_result:report,
  stop_loss:plan.definition.stopPrice,take_profit:null,notes:plan.definition.thesis||'',quality_grade:null,quality_score:null,quality_metrics:null,setup:plan.definition.setup||''};
 return trade;
}

async function resolvePlanTrade(req,source){
 if(req.query?.source==='1'||req.query?.raw_currency==='1')return source;
 if(!req.user?.id||req.user.id!==source.user_id){if(req.query?.planId)fail('Plan trade not found',404);return source;}
 const requested=req.query?.planId;
 if(requested&&!guid.test(String(requested)))fail('Invalid plan ID',400);
 const plans=(await db.query(`SELECT DISTINCT p.* FROM trade_plans p JOIN trade_plan_allocations a ON a.plan_id=p.id AND a.user_id=p.user_id WHERE p.user_id=$1 AND a.trade_id=$2 ${requested?'AND p.id=$3':''}`,[req.user.id,source.id,...(requested?[requested]:[])])).rows;
 if(requested&&plans.length!==1)fail('This trade is not linked to the selected plan',404);
 if(plans.length!==1)return source;
 const plan=plans[0];
 const allocations=(await db.query('SELECT * FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2',[plan.id,req.user.id])).rows;
 let trades=(await db.query('SELECT * FROM trades WHERE user_id=$1 AND id=ANY($2::uuid[])',[req.user.id,[...new Set(allocations.map(a=>a.trade_id))]])).rows;
 if(trades.some(t=>t.broker==='trading212')){const sources=require('./planBrokerFills');trades=sources.attachSources(trades,allocations,await sources.loadGroups(db,req.user.id));}
 const result=await require('./planningCashflows').enrich(db,plan,ledger({...plan,management:{}},allocations,trades),trades);
 const fx=result.accounts?.length>1?await require('./planningFx').latestPlanningFx():null;
 const trade=projectPlanTrade(source,plan,result,fx);
 if(plan.definition.currency!==result.currency){const fx=await require('./planningFx').latestPlanningFx();const rates={USD:1,...fx?.rates};trade.stop_loss=rates[result.currency]>0&&rates[plan.definition.currency]>0?plan.definition.stopPrice*rates[result.currency]/rates[plan.definition.currency]:null;}
 if(req.accountReports){req.accountReports=new Map(req.accountReports);req.accountReports.set(trade.id,trade.account_pnl_result);}
 return trade;
}
module.exports={projectPlanTrade,resolvePlanTrade};
