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
async function clear(client,userId,identifier,records,cutoff){
 const rows=(await client.query("SELECT id,evidence FROM ig_statement_ingestion WHERE user_id=$1 AND account_identifier=$2 AND status='imported' AND reason IN ('activity_pending','cash_date_conflict') FOR UPDATE",[userId,identifier])).rows;
 for(const row of rows){
  if(!cutoff||!row.evidence?.date||row.evidence.date>cutoff.slice(0,10))continue;
  if(reconciled(row.evidence,records))await client.query("UPDATE ig_statement_ingestion SET reason=NULL WHERE id=$1 AND user_id=$2",[row.id,userId]);
  else if(row.evidence?.date&&cashAt(row.evidence,records)!==cents(row.evidence.cash)){
   // The importer has reconciled the ledger to its latest confirmation. Keep
   // contradictory PDF evidence, but never backdate its cash on the chart.
   const stored=(await client.query('SELECT cash_usd,holdings_usd,gbp_per_usd FROM portfolio_statement_values WHERE user_id=$1 AND account_identifier=$2 AND value_date=$3 FOR UPDATE',[userId,identifier,row.evidence.date])).rows[0];
   if(stored&&require('./igStatementIngester').samePoint(stored,row.evidence))
    await client.query('DELETE FROM portfolio_statement_values WHERE user_id=$1 AND account_identifier=$2 AND value_date=$3',[userId,identifier,row.evidence.date]);
   await client.query("UPDATE ig_statement_ingestion SET reason='cash_date_conflict' WHERE id=$1 AND user_id=$2",[row.id,userId]);
  }
 }
}
module.exports={clear,reconciled,cashAt};
