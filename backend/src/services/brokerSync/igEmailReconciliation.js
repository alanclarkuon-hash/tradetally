const {cents}=require('./igStatement'),{signature}=require('./igEmailCash'),{localToUTC}=require('../../utils/timezone');
function cashAt(point,records){
 const end=new Date(localToUTC(point.date+'T23:59:59','Europe/London')).toISOString();
 return records.filter(r=>r.time<=end).reduce((s,r)=>s+cents(r.cash),0);
}
function reconciled(point,records){
 if(!point?.activitySupported||!point.date||!Array.isArray(point.records))return false;
 const end=new Date(localToUTC(point.date+'T23:59:59','Europe/London')).toISOString();
 if(records.filter(r=>r.time<=end).reduce((s,r)=>s+cents(r.cash),0)!==cents(point.cash))return false;
 return point.records.every(e=>records.filter(r=>signature(r)===signature(e)).length===1);
}
function coveredActivity(point,records){
 return point?.activitySupported&&Array.isArray(point.records)&&point.records.every(e=>records.filter(r=>signature(r)===signature(e)).length===1);
}
function superseded(point,later,records,cutoff){
 return coveredActivity(point,records)&&later?.date>point.date&&later.date<=cutoff.slice(0,10)&&reconciled(later,records)
  &&Array.isArray(point.positions)&&Array.isArray(later.positions)&&point.positions.length===later.positions.length
  &&point.positions.every(p=>later.positions.some(h=>h.isin===p.isin&&h.quantity===p.quantity&&cents(h.cost)===cents(p.cost)));
}
async function clear(client,userId,identifier,records,cutoff){
 const rows=(await client.query("SELECT id,evidence,reason,status FROM ig_statement_ingestion WHERE user_id=$1 AND account_identifier=$2 AND (status='imported' OR (status='review' AND reason='cash_date_conflict')) FOR UPDATE",[userId,identifier])).rows;
 for(const row of rows){
  if(!['activity_pending','cash_date_conflict','resolved_by_later_history'].includes(row.reason))continue;
  if(!cutoff||!row.evidence?.date||row.evidence.date>cutoff.slice(0,10))continue;
  if(reconciled(row.evidence,records))await client.query("UPDATE ig_statement_ingestion SET reason=NULL WHERE id=$1 AND user_id=$2",[row.id,userId]);
  else if(row.evidence?.date&&cashAt(row.evidence,records)!==cents(row.evidence.cash)){
   // The importer has reconciled the ledger to its latest confirmation. Keep
   // contradictory PDF evidence, but never backdate its cash on the chart.
   const stored=(await client.query('SELECT cash_usd,holdings_usd,gbp_per_usd FROM portfolio_statement_values WHERE user_id=$1 AND account_identifier=$2 AND value_date=$3 FOR UPDATE',[userId,identifier,row.evidence.date])).rows[0];
   if(stored&&require('./igStatementIngester').samePoint(stored,row.evidence))
    await client.query('DELETE FROM portfolio_statement_values WHERE user_id=$1 AND account_identifier=$2 AND value_date=$3',[userId,identifier,row.evidence.date]);
   const later=rows.find(r=>r.status==='imported'&&superseded(row.evidence,r.evidence,records,cutoff));
   if(later)await client.query("UPDATE ig_statement_ingestion SET status='imported',reason='resolved_by_later_history' WHERE id=$1 AND user_id=$2",[row.id,userId]);
   else await client.query("UPDATE ig_statement_ingestion SET reason='cash_date_conflict' WHERE id=$1 AND user_id=$2",[row.id,userId]);
  }
 }
}
module.exports={clear,reconciled,cashAt,superseded};
