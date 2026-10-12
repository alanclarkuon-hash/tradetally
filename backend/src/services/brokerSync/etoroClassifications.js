const crypto=require('crypto');
const {isDeepStrictEqual}=require('node:util');
const {mapClosedPositions,matches}=require('./etoroStatement');
const fail=m=>{throw Error('eToro upload: '+m)};
const executions=t=>typeof t.executions==='string'?JSON.parse(t.executions):t.executions||[];
function planClassifications(statement,trades,allocations=[]) {
 const mapped=mapClosedPositions(statement['Closed Positions']);
 const updates=[],counts={verified:0,corrected:0,unmatched:0,affectedPlans:0,types:{}};
 const affected=new Set();
 for(const row of mapped){
  const candidates=trades.filter(t=>executions(t).some(e=>String(e.etoro_position_id)===row.positionId));
  const exact=candidates.filter(t=>t.symbol===row.symbol&&t.side===row.side&&matches(t,row));
  if(!exact.length){if(candidates.length)fail('Statement position differs from the saved trade. Resolve it before importing.');counts.unmatched++;continue;}
  if(exact.length!==1)fail('Statement position matches multiple saved trades. Resolve it before importing.');
  const t=exact[0],es=executions(t),meta=row.executions[0];
  const declared=new Set(es.map(e=>e.etoro_source_type).filter(Boolean));
  if(declared.size>1||[...declared].some(v=>({Stocks:'stock',ETF:'stock',Crypto:'crypto',CFD:'cfd'}[v]||v)!==row.type))fail('Conflicting broker instrument classifications. Resolve them before importing.');
  counts.verified++;counts.types[meta.etoro_source_type]=(counts.types[meta.etoro_source_type]||0)+1;
  if(t.instrument_type!==row.type){counts.corrected++;for(const a of allocations.filter(a=>a.trade_id===t.id))affected.add(a.plan_id);}
  const next=es.map(e=>({...e,etoro_source_type:meta.etoro_source_type,etoro_copied_from:meta.etoro_copied_from,etoro_leverage:meta.etoro_leverage,...(e.action===(t.side==='short'?'sell':'buy')?{etoro_invested_capital:meta.etoro_invested_capital,etoro_capital_currency:'USD',etoro_capital_basis:'statement_amount'}:{})}));
  if(t.instrument_type!==row.type||!isDeepStrictEqual(es,next))updates.push({id:t.id,instrument:row.type,executions:next});
 }
 counts.affectedPlans=affected.size;
 return {updates,counts,revision:crypto.createHash('sha256').update(JSON.stringify([trades,allocations])).digest('hex')};
}
async function loadClassifications(client,userId,account,statement,lock=false){
 const trades=(await client.query(`SELECT * FROM trades WHERE user_id=$1 AND broker='etoro' AND account_identifier=$2 ORDER BY id ${lock?'FOR UPDATE':''}`,[userId,account.account_identifier])).rows;
 const allocations=(await client.query('SELECT a.* FROM trade_plan_allocations a JOIN trades t ON t.id=a.trade_id WHERE a.user_id=$1 AND t.account_identifier=$2 ORDER BY a.id',[userId,account.account_identifier])).rows;
 return planClassifications(statement,trades,allocations);
}
module.exports={planClassifications,loadClassifications};
