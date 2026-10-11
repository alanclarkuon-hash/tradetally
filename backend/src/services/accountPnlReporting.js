const db=require('../config/database');
const {calculateAccountResult}=require('./accountRealisedPnl');
const AnalyticsCache=require('./analyticsCache');
const pending=new Map();
async function refreshAccountResults(userId) {
 if(pending.has(userId))return pending.get(userId);
 const job=(async()=>{
  const client=await db.connect();let changed=0;
  try {
   await client.query('BEGIN');
   // Account-scoped transaction lock serialises simultaneous reporting reads.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId]);
   const rows=(await client.query(`SELECT t.*,a.currency AS configured_account_currency,
     md5(to_jsonb(t)::text || COALESCE(a.currency,'')) AS source_signature
    FROM trades t LEFT JOIN LATERAL (SELECT currency FROM user_accounts ua
     WHERE ua.user_id=t.user_id AND ua.account_identifier=t.account_identifier
     ORDER BY (ua.broker=t.broker) DESC NULLS LAST,ua.is_archived ASC,ua.is_primary DESC,ua.created_at ASC LIMIT 1) a ON true
    LEFT JOIN trade_account_reports r ON r.trade_id=t.id
    WHERE t.user_id=$1 AND r.source_signature IS DISTINCT FROM md5(to_jsonb(t)::text || COALESCE(a.currency,'')) FOR SHARE OF t`,[userId])).rows;
   for(const trade of rows) {
    const result=calculateAccountResult(trade,trade.configured_account_currency);
    await client.query(`INSERT INTO trade_account_reports(trade_id,user_id,source_signature,result) VALUES($1,$2,$3,$4::jsonb)
     ON CONFLICT(trade_id) DO UPDATE SET source_signature=EXCLUDED.source_signature,result=EXCLUDED.result,calculated_at=NOW()`,[trade.id,userId,trade.source_signature,JSON.stringify(result)]);changed++;
   }
   if(changed)await client.query('DELETE FROM analytics_cache WHERE user_id=$1',[userId]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  if(changed)await AnalyticsCache.invalidate(userId);
  return changed;
 })();
 pending.set(userId,job);try{return await job;}finally{pending.delete(userId);}
}
async function reportAccountPnl(req,res,next) {
 try {
  if(req.user?.id){await refreshAccountResults(req.user.id);const rates=await require('../utils/tradeFx').getUsdRateMap();req.accountFxKey=require('crypto').createHash('sha256').update(JSON.stringify(rates||{})).digest('hex').slice(0,16);req.accountReports=new Map((await db.query('SELECT trade_id,result FROM trade_account_reports WHERE user_id=$1',[req.user.id])).rows.map(r=>[r.trade_id,r.result]));}
  next();
 }catch(error){next(error);}
}
module.exports={refreshAccountResults,reportAccountPnl};
