async function load(client,userId,evidence){
 const [trades,snapshots,plans,settings,fx,manual]=await Promise.all([
  client.query('SELECT * FROM trades WHERE user_id=$1 AND exit_time IS NULL',[userId]),
  client.query('SELECT * FROM broker_portfolio_snapshots WHERE user_id=$1',[userId]),
  client.query("SELECT * FROM trade_plans WHERE user_id=$1 AND status NOT IN ('cancelled','completed')",[userId]),
  client.query('SELECT settings FROM trade_planning_settings WHERE user_id=$1',[userId]),
  require('../services/planningFx').latestPlanningFx().then(value=>({rows:value?[value]:[]})),
  client.query('SELECT COUNT(*) AS count FROM investment_holdings WHERE user_id=$1',[userId])
 ]);
 const ids=[...new Set([...trades.rows.map(t=>t.account_identifier||'unassigned'),...snapshots.rows.map(t=>t.account_identifier)])];
 const groups=Object.fromEntries(ids.flatMap(id=>Object.entries(require('../services/brokerSync/portfolioSnapshot').dashboardPositions(trades.rows.filter(t=>(t.account_identifier||'unassigned')===id),snapshots.rows.filter(t=>t.account_identifier===id))).map(([key,value])=>[id+'|'+key,value])));
 const accountRows=(await client.query('SELECT id,account_identifier,currency,account_name,broker FROM user_accounts WHERE user_id=$1',[userId])).rows;
 const brokerCoverage=await require('./planningBrokerCoverage').load(client,userId,accountRows);
 const planEvidence=(await Promise.all(plans.rows.filter(p=>p.baseline).map(async p=>{
  const result=await evidence(client,p);
  return require('./planningAccounts').accountIds(p.definition).map(id=>{const own=result.accounts?.find(a=>a.accountId===id);return {plan:p,account:accountRows.find(a=>a.id===id)?.account_identifier,result:own?{...result,openQuantity:own.openQuantity,capitalRisk:own.capitalRisk,capitalRiskCurrency:own.capitalRiskCurrency,maximumLoss:own.maximumLoss,maximumLossCurrency:own.maximumLossCurrency}:result}});
 }))).flat();
 const config=settings.rows[0]?.settings||{},currency=config.currency||'GBP',rates={USD:1,...fx.rows[0]?.rates};
 const cross=(from,to)=>rates[from]>0&&rates[to]>0?rates[to]/rates[from]:null;
 let knownRisk=0,conservativeRisk=0,unknown=0;const positions=[];
 for(const [identity,pos] of Object.entries(groups)){
  const stops=[...new Set(pos.trades.map(t=>Number(t.stop_loss)).filter(v=>v>0))];
  const stop=stops.length===1?stops[0]:null;
  const rate=cross(pos.currency,currency);
  const recorded=require('./planningStopCoverage').recorded(pos);
  let risk=rate>0&&recorded.risk!=null?recorded.risk*rate:null;
  let stopEvidence={source:recorded.source,coveredQuantity:recorded.coveredQuantity,asOf:recorded.asOf,brokerConfirmed:false};
  const matched=planEvidence.filter(e=>identity.startsWith((e.account||'unassigned')+'|')&&e.plan.definition.symbol===pos.symbol&&e.plan.definition.instrument===pos.instrumentType&&e.plan.definition.direction===pos.side&&e.result.openQuantity>0);
  if(matched.length&&matched.every(e=>e.result.capitalRisk!=null&&e.result.coverageComplete)&&Math.abs(matched.reduce((sum,e)=>sum+e.result.openQuantity,0)-pos.totalQuantity)<1e-8){
   stopEvidence={source:'Manual plan invalidation levels',coveredQuantity:pos.totalQuantity,asOf:matched.map(e=>e.plan.updated_at).filter(Boolean).sort().at(-1)||null,brokerConfirmed:false};
   risk=matched.reduce((sum,e)=>sum+e.result.capitalRisk*(cross(e.result.capitalRiskCurrency||e.result.currency,currency)||0),0);
   if(matched.some(e=>!cross(e.result.capitalRiskCurrency||e.result.currency,currency)))risk=null;
  }
  const accountId=accountRows.find(a=>identity.startsWith(a.account_identifier+'|'))?.id||null;
  const workingStop=require('./planningBrokerCoverage').stopRisk(pos,brokerCoverage.find(b=>b.accountId===accountId));
  if(workingStop&&rate>0){risk=workingStop.risk*rate;stopEvidence=workingStop;}
  let maximumLoss=null;
  if(pos.instrumentType==='option'&&pos.side==='long'&&rate>0&&Number(pos.contractSize)>0&&Number(pos.avgPrice)>=0)maximumLoss=pos.totalQuantity*pos.avgPrice*Number(pos.contractSize)*rate;
  if(matched.length&&matched.every(e=>e.result.maximumLoss!=null&&e.result.coverageComplete)&&Math.abs(matched.reduce((sum,e)=>sum+e.result.openQuantity,0)-pos.totalQuantity)<1e-8){
   maximumLoss=matched.every(e=>cross(e.result.maximumLossCurrency||e.result.currency,currency))?matched.reduce((s,e)=>s+e.result.maximumLoss*cross(e.result.maximumLossCurrency||e.result.currency,currency),0):null;
  }
  if(maximumLoss!=null)conservativeRisk+=maximumLoss;
  if(risk==null)unknown++;else knownRisk+=risk;
  const unit=require('../utils/quoteCurrency').normaliseMinorUnit(pos.brokerQuote?.currency||pos.currency),quoteRate=unit?cross(unit.code,currency):null;
  const exposure=['stock','cfd','crypto'].includes(pos.instrumentType)&&pos.brokerQuote?.c>0&&quoteRate?pos.totalQuantity*pos.brokerQuote.c/unit.divisor*quoteRate:null;
  positions.push({exposure,accountId:accountRows.find(a=>identity.startsWith(a.account_identifier+'|'))?.id||null,symbol:pos.symbol,quantity:pos.totalQuantity,risk,maximumLoss,...stopEvidence,source:risk==null?'Incomplete stop quantity, currency or FX evidence':stopEvidence.source});
 }
const remainingFraction=require('./planningCommitments').remainingFraction;
const commitments=(await client.query("SELECT account_id,currency,risk_amount,snapshot FROM trade_plan_commitments WHERE user_id=$1 AND status='reserved'",[userId])).rows;
 for(const c of commitments){const r=cross(c.currency,currency);if(r)knownRisk+=Number(c.risk_amount)*r;else unknown++;}
 // Manual investments need lot-level stops before they can count as known risk.
 if(Number(manual.rows[0]?.count)>0)unknown+=Number(manual.rows[0].count);
 const brokerCapacity=(await client.query('SELECT account_id,currency,available_cash,source,as_of FROM broker_capacity_evidence WHERE user_id=$1',[userId])).rows;
 const scoped=config.tradingAccountIds==null?positions:positions.filter(p=>config.tradingAccountIds.includes(p.accountId));
 const accountSummaries=accountRows.map(a=>{const cashEvidence=brokerCapacity.find(b=>b.account_id===a.id&&require('./planningBrokerEvidence').fresh(b.as_of,15)&&cross(b.currency,currency));const own=positions.filter(p=>p.accountId===a.id),limit=config.accountLimits?.find(l=>l.accountId===a.id);return {reservedCash:commitments.filter(c=>c.account_id===a.id).reduce((v,c)=>v+(c.snapshot?.capacityCheck?.cash!=null&&cross(c.snapshot.capacity?.currency,currency)?c.snapshot.capacityCheck.cash*remainingFraction(c.snapshot)*cross(c.snapshot.capacity.currency,currency):0),0),buyingPowerUnknown:commitments.filter(c=>c.account_id===a.id&&(c.snapshot?.capacityCheck?.cash==null||!cross(c.snapshot.capacity?.currency,currency))).length,knownExposure:own.reduce((v,p)=>v+(p.exposure||0),0)+commitments.filter(c=>c.account_id===a.id).reduce((v,c)=>v+(c.snapshot?.capacityCheck?.exposure!=null&&cross(c.snapshot.capacity?.currency,currency)?c.snapshot.capacityCheck.exposure*remainingFraction(c.snapshot)*cross(c.snapshot.capacity.currency,currency):0),0),exposureUnknown:own.filter(p=>p.exposure==null).length+commitments.filter(c=>c.account_id===a.id&&(c.snapshot?.capacityCheck?.exposure==null||!cross(c.snapshot.capacity?.currency,currency))).length,exposureLimit:limit?.equity>0&&limit?.exposureMultiple>0?limit.equity*limit.exposureMultiple:null,buyingPower:cashEvidence?Number(cashEvidence.available_cash)*cross(cashEvidence.currency,currency):limit?.buyingPower??null,buyingPowerSource:cashEvidence?.source||(limit?.buyingPower!=null?'Manual account capacity':'Unavailable'),buyingPowerAsOf:cashEvidence?.as_of||null,brokerBuyingPowerVerified:!!cashEvidence,brokerEvidence:brokerCoverage.find(b=>b.accountId===a.id),accountId:a.id,name:a.account_name,knownRisk:own.reduce((v,p)=>v+(p.risk||0),0)+commitments.filter(c=>c.account_id===a.id).reduce((v,c)=>v+(cross(c.currency,currency)?Number(c.risk_amount)*cross(c.currency,currency):0),0),conservativeRisk:own.reduce((v,p)=>v+(p.maximumLoss||0),0),unknown:own.filter(p=>p.risk==null).length+commitments.filter(c=>c.account_id===a.id&&!cross(c.currency,currency)).length,limit:config.accountLimits?.find(l=>l.accountId===a.id)?.limit??null,inScope:config.tradingAccountIds==null||config.tradingAccountIds.includes(a.id)}});
 return {accounts:accountSummaries,tradingAccountIds:config.tradingAccountIds??null,outsideRisk:accountSummaries.filter(a=>!a.inScope).reduce((v,a)=>v+a.knownRisk,0),knownRisk:config.tradingAccountIds==null?knownRisk:accountSummaries.filter(a=>a.inScope).reduce((s,a)=>s+a.knownRisk,0),conservativeRisk:scoped.reduce((v,p)=>v+(p.maximumLoss||0),0),outsideUnknown:accountSummaries.filter(a=>!a.inScope).reduce((v,a)=>v+a.unknown,0),unknown:config.tradingAccountIds==null?unknown:scoped.filter(p=>p.risk==null).length+positions.filter(p=>p.accountId==null&&p.risk==null).length+Number(manual.rows[0]?.count||0)+commitments.filter(c=>config.tradingAccountIds.includes(c.account_id)&&!cross(c.currency,currency)).length,positions,currency,rates,limit:config.portfolioLimit||null,fxDate:fx.rows[0]?.rate_date||null,selectedLevel:config.selectedLevel??null};

}
module.exports={load};
