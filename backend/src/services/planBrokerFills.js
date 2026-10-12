// Plan sources are original broker executions, independent of matched trade pairs.
// Existing trade IDs remain navigation anchors, never the financial source boundary.
const crypto=require('crypto');
const {sourceFills}=require('./planningLedger');
const stableNumber=v=>Number(Number(v).toFixed(10));
function executionIdentity(trade,e){
 const id=e.order_id??e.orderId??e.fill_id??e.execution_id;
 return trade.broker==='trading212'&&id!=null&&['buy','sell'].includes(e.action)?String(id):null;
}
function originalGroups(trades,detached=[]){
 const groups=new Map();
 const add=(trade,e,index,isDetached=false)=>{
  const identity=executionIdentity(trade,e);if(!identity||trade.original_entry_price_currency!=null)return;
  const key='id:broker:'+crypto.createHash('sha256').update(JSON.stringify([trade.broker,trade.account_identifier,trade.symbol,e.action,identity])).digest('hex');
  const direction='long',normal={...trade,side:direction,commission:null,fees:null,executions:[e]};
  const f=sourceFills(normal)[0];if(!f)return;
  const originalFill=isDetached?null:sourceFills(trade).find(x=>x.sourceIndex===index);
  if(!groups.has(key))groups.set(key,{key,identity,broker:trade.broker,account:trade.account_identifier,symbol:trade.symbol,parts:[],quantity:0,commission:0,fees:0,reported:0,reportedQuantity:0,valid:true,fill:f});
  const g=groups.get(key),first=g.fill;
  if(originalFill?.costsVerified===false)g.valid=false;
  if(first.price!==f.price||first.time!==f.time||first.currency!==f.currency||JSON.stringify(first.transactionFx)!==JSON.stringify(f.transactionFx))g.valid=false;
  g.quantity+=f.quantity;g.commission+=f.commission;g.fees+=f.fees;
  if(e.broker_result!=null&&Number.isFinite(Number(e.broker_result))&&e.broker_result_currency===f.transactionFx?.accountCurrency){g.reported+=Number(e.broker_result);g.reportedQuantity+=f.quantity;}
  g.parts.push({tradeId:trade.id,key:originalFill?.key||null,quantity:f.quantity,detached:isDetached,index});
 };
 for(const t of trades)if(t.broker==='trading212'&&(t.instrument_type||'stock')==='stock')for(const [i,e]of(t.executions||[]).entries())add(t,e,i);
 for(const d of detached)add(d.trade,d.execution,0,true);
 for(const g of groups.values()){
  g.quantity=stableNumber(g.quantity);g.commission=stableNumber(g.commission);g.fees=stableNumber(g.fees);
  const anchor=[...g.parts].sort((a,b)=>a.tradeId.localeCompare(b.tradeId))[0].tradeId;
  const e={id:g.key.slice(3),order_id:g.identity,action:g.fill.action==='entry'?'buy':'sell',quantity:g.quantity,price:g.fill.price,datetime:g.fill.time,commission:g.commission,fees:g.fees,account_currency:g.fill.transactionFx?.accountCurrency,broker_fx_rate:g.fill.transactionFx?.rate,
   broker_result:g.reportedQuantity>0?Math.round(g.reported*g.quantity/g.reportedQuantity*100)/100:null,broker_result_currency:g.fill.transactionFx?.accountCurrency};
  g.trade={id:g.key,side:'long',symbol:g.symbol,broker:g.broker,account_identifier:g.account,instrument_type:'stock',original_currency:g.fill.currency,commission:g.commission,fees:g.fees,executions:[e]};
  g.fill={...sourceFills(g.trade)[0],brokerExecution:{identity:g.identity,key:g.key,broker:g.broker,account:g.account},tradeId:anchor,account:g.account};
 }
 const result=[...groups.values()];result.sourceTrades=trades;return result;
}
function usedQuantity(group,allocations){
 return allocations.reduce((sum,a)=>sum+(a.source_snapshot?.brokerExecution?.key===group.key||a.source_key===group.key||group.parts.some(p=>p.key&&p.tradeId===a.trade_id&&p.key===a.source_key)?Number(a.quantity):0),0);
}
function availableGroups(groups,allocations){
 return groups.filter(g=>g.valid).map(g=>({...g.fill,allocated:usedQuantity(g,allocations),sharedPlans:[...new Set(allocations.filter(a=>a.source_snapshot?.brokerExecution?.key===g.key||a.source_key===g.key||g.parts.some(p=>p.key&&p.tradeId===a.trade_id&&p.key===a.source_key)).map(a=>a.plan_id).filter(Boolean))],available:stableNumber(Math.max(0,g.quantity-usedQuantity(g,allocations)))})).filter(f=>f.available>1e-8).sort((a,b)=>b.time.localeCompare(a.time)||a.key.localeCompare(b.key));
}
async function loadGroups(client,userId,account=null,symbol=null,locked=false,aliases=[]){
 const params=[userId,account,symbol,aliases];
 const trades=(await client.query(`SELECT * FROM trades WHERE user_id=$1 AND broker='trading212' AND COALESCE(instrument_type,'stock')='stock' AND ($2::text IS NULL OR account_identifier=$2) AND ($3::text IS NULL OR UPPER(symbol)=UPPER($3) OR UPPER(symbol)=ANY($4::text[])) ORDER BY id ${locked?'FOR UPDATE':''}`,params)).rows;
 const detached=(await client.query(`SELECT d.execution,t.* FROM detached_trade_exits d JOIN trades t ON t.id=d.origin_trade_id WHERE d.user_id=$1 AND t.user_id=$1 AND d.assigned_trade_id IS NULL AND t.broker='trading212' AND COALESCE(t.instrument_type,'stock')='stock' AND ($2::text IS NULL OR t.account_identifier=$2) AND ($3::text IS NULL OR UPPER(t.symbol)=UPPER($3) OR UPPER(t.symbol)=ANY($4::text[])) ORDER BY d.id ${locked?'FOR UPDATE OF d':''}`,params)).rows.map(t=>({trade:t,execution:t.execution}));
 return originalGroups(trades,detached);
}
function originalSettlementReports(groups){
 const settle=require('./trading212Settlements').settlements;
 const legacy=settle(groups.sourceTrades||[]);
 const canonical=settle(groups.filter(g=>g.valid).map(g=>g.trade));
 for(const g of groups.filter(g=>g.valid&&g.fill.action==='exit')){
  let units=0,gross=0,entryFees=0;
  const exitFeePerUnit=(g.commission+g.fees)/g.quantity/(g.fill.transactionFx?.rate||1);
  for(const part of g.parts){
   const report=legacy.get(part.tradeId),e=report?.status==='complete'&&report.events.find(e=>e.sourceKey===part.key);
   if(!e||report.currency!==g.fill.transactionFx?.accountCurrency)continue;
   units+=part.quantity;gross+=e.gross_pnl;entryFees+=e.fees-exitFeePerUnit*part.quantity;
  }
  // A broker fill was proportionally split across matched records. Its supplied
  // gross result and proportional fees reconstruct the whole original event;
  // no buy/sell matching or plan quantities are rewritten.
  if(units>0){
   const supplied=g.trade.executions[0].broker_result;
   const fullGross=supplied??Math.round(gross*g.quantity/units*100)/100;
   const fees=entryFees*g.quantity/units+(g.commission+g.fees)/(g.fill.transactionFx?.rate||1);
   const event={sourceIndex:0,sourceKey:g.key,time:g.fill.time,gross_pnl:fullGross,pnl:fullGross-fees,fees,commission:0};
   canonical.set(g.key,{status:'complete',basis:'original_broker_execution',currency:g.fill.transactionFx?.accountCurrency,events:[event],pnl:event.pnl,fees,commission:0});
  }
 }
 return {legacy,canonical};
}
function attachSources(trades,allocations,groups){
 const {legacy,canonical}=originalSettlementReports(groups);
 return trades.map(original=>{
  if(original.broker!=='trading212')return original;
  const selected=allocations.filter(a=>a.trade_id===original.id&&a.source_snapshot?.brokerExecution).map(a=>groups.find(g=>g.valid&&g.key===a.source_snapshot.brokerExecution.key)).filter(Boolean);
  const unique=[...new Map(selected.map(g=>[g.key,g])).values()];
  if(!unique.length)return {...original,broker_settlement:legacy.get(original.id)};
  const executions=[...(original.executions||[]),...unique.map(g=>g.trade.executions[0])];
  const t={...original,executions,commission:executions.reduce((s,e)=>s+Number(e.commission||0),0),fees:executions.reduce((s,e)=>s+Number(e.fees||e.fee||0),0)};
  if(original.side==='short')t.side='long';
  const events=[...(legacy.get(original.id)?.status==='complete'?legacy.get(original.id).events:[])];
  const currencies=new Set(events.length?[legacy.get(original.id).currency]:[]);
  for(const g of unique){
   const report=canonical.get(g.key),e=report?.status==='complete'&&report.events[0];
   if(e){currencies.add(report.currency);events.push({...e,sourceIndex:executions.findIndex(e=>e.id===g.key.slice(3)),sourceKey:g.key});}
  }
  if(events.length&&currencies.size===1)t.broker_settlement={status:'complete',currency:[...currencies][0],events};
  return t;
 });
}

module.exports={originalGroups,usedQuantity,availableGroups,loadGroups,attachSources,originalSettlementReports};
