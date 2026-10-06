const {cents}=require('./igStatement'),{signature}=require('./igEmailCash'),{localToUTC}=require('../../utils/timezone');
function reconciled(point,records){
 if(!point?.activitySupported||!point.date||!Array.isArray(point.records))return false;
 const end=new Date(localToUTC(point.date+'T23:59:59','Europe/London')).toISOString();
 if(records.filter(r=>r.time<=end).reduce((s,r)=>s+cents(r.cash),0)!==cents(point.cash))return false;
 return point.records.every(e=>records.filter(r=>signature(r)===signature(e)).length===1);
}
async function clear(client,userId,identifier,records){
 const rows=(await client.query("SELECT id,evidence FROM ig_statement_ingestion WHERE user_id=$1 AND account_identifier=$2 AND status='imported' AND reason='activity_pending' FOR UPDATE",[userId,identifier])).rows;
 for(const row of rows)if(reconciled(row.evidence,records))await client.query("UPDATE ig_statement_ingestion SET reason=NULL WHERE id=$1 AND user_id=$2",[row.id,userId]);
}
module.exports={clear,reconciled};
