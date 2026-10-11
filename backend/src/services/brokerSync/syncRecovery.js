const db=require('../../config/database');
const ACTIVE=['started','fetching','parsing','importing'];
const MESSAGE='Sync interrupted by application restart. Committed records are retained; retry the sync to finish.';
// Session locks survive long broker requests and are released by PostgreSQL
// when the worker process exits. Another instance must never recover a live job.
async function acquire(connectionId){
 const client=await db.connect();let acquired=false;
 try{
  acquired=(await client.query("SELECT pg_try_advisory_lock(hashtext('broker-sync-run'),hashtext($1)) AS acquired",[connectionId])).rows[0].acquired;
  if(!acquired){client.release();return null;}
  let released=false;
  return {client,async release(){if(released)return;released=true;let error;try{await client.query("SELECT pg_advisory_unlock(hashtext('broker-sync-run'),hashtext($1))",[connectionId]);}catch(e){error=e;}finally{client.release(error);}}};
 }catch(error){client.release(error);throw error;}
}
async function recoverConnection(client,connectionId,before=new Date()){
 await client.query('BEGIN');
 try{
  const result=await client.query(`UPDATE broker_sync_logs SET status='failed',error_message=$4,
   error_details=COALESCE(error_details,'{}'::jsonb)||jsonb_build_object('code','sync_interrupted','retryable',true),
   sync_details=COALESCE(sync_details,'{}'::jsonb)||jsonb_build_object('outcome','interrupted'),
   completed_at=CURRENT_TIMESTAMP,duration_ms=LEAST(2147483647,GREATEST(0,EXTRACT(EPOCH FROM(CURRENT_TIMESTAMP-started_at))*1000))
   WHERE connection_id=$1 AND status=ANY($2::text[]) AND completed_at IS NULL AND started_at<$3
   RETURNING id,started_at`,[connectionId,ACTIVE,before,MESSAGE]);
  if(result.rows.length){
   const latest=result.rows.reduce((a,r)=>new Date(r.started_at)>new Date(a)?r.started_at:a,result.rows[0].started_at);
   await client.query(`UPDATE broker_connections SET last_sync_status='failed',last_sync_message=$3,last_error_message=$3,last_error_at=NOW(),updated_at=NOW()
    WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM broker_sync_logs WHERE connection_id=$1 AND started_at>$2)`,[connectionId,latest,MESSAGE]);
  }
  await client.query('COMMIT');return result.rows.length;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
async function recoverAbandoned(before=new Date()){
 const candidates=(await db.query('SELECT DISTINCT connection_id FROM broker_sync_logs WHERE status=ANY($1::text[]) AND completed_at IS NULL AND started_at<$2',[ACTIVE,before])).rows;
 let recovered=0,active=0;
 for(const {connection_id:id}of candidates){const lease=await acquire(id);if(!lease){active++;continue;}try{recovered+=await recoverConnection(lease.client,id,before);}finally{await lease.release();}}
 return {recovered,active};
}
module.exports={acquire,recoverConnection,recoverAbandoned};
