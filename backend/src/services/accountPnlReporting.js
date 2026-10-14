const db=require('../config/database');
const {calculateAccountResult}=require('./accountRealisedPnl');
const AnalyticsCache=require('./analyticsCache');
const pending=new Map(),lastReportingFx=new Map();
async function refreshAccountResults(userId) {
 if(pending.has(userId))return pending.get(userId);
 const job=(async()=>{
  const client=await db.connect();let changed=0;
  try {
   await client.query('BEGIN');
   // Account-scoped transaction lock serialises simultaneous reporting reads.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId]);
   const rows=(await client.query(`WITH detached_signatures AS (SELECT t.account_identifier,t.symbol,md5(string_agg(to_jsonb(d)::text,'' ORDER BY d.id)) AS signature FROM detached_trade_exits d JOIN trades t ON t.id=d.origin_trade_id WHERE d.user_id=$1 AND t.user_id=$1 AND d.assigned_trade_id IS NULL GROUP BY t.account_identifier,t.symbol), pool_signatures AS (SELECT h.account_identifier,h.symbol,md5(string_agg(to_jsonb(h)::text,'' ORDER BY h.id)||COALESCE(MAX(d.signature),'')||COALESCE(MAX((prices.payload->'splits')::text),'')||COALESCE(MAX(prices.payload->>'currency'),'')) AS signature FROM trades h LEFT JOIN portfolio_reconstruction_prices prices ON prices.symbol=h.symbol LEFT JOIN detached_signatures d ON d.account_identifier=h.account_identifier AND d.symbol=h.symbol WHERE h.user_id=$1 AND h.broker='trading212' GROUP BY h.account_identifier,h.symbol)
    SELECT t.*,a.currency AS configured_account_currency,
     md5(to_jsonb(t)::text || COALESCE(a.currency,'') || ':account-pnl-v8' || COALESCE(pool.signature,'')) AS source_signature
    FROM trades t LEFT JOIN LATERAL (SELECT currency FROM user_accounts ua
     WHERE ua.user_id=t.user_id AND ua.account_identifier=t.account_identifier
     ORDER BY (ua.broker=t.broker) DESC NULLS LAST,ua.is_archived ASC,ua.is_primary DESC,ua.created_at ASC LIMIT 1) a ON true
    LEFT JOIN pool_signatures pool ON t.broker='trading212' AND pool.account_identifier=t.account_identifier AND pool.symbol=t.symbol
    LEFT JOIN trade_account_reports r ON r.trade_id=t.id
    WHERE t.user_id=$1 AND r.source_signature IS DISTINCT FROM md5(to_jsonb(t)::text || COALESCE(a.currency,'') || ':account-pnl-v8' || COALESCE(pool.signature,'')) FOR SHARE OF t`,[userId])).rows;
   const groups=rows.some(t=>t.broker==='trading212')?await require('./planBrokerFills').loadGroups(client,userId):[];
   const pooled=require('./accountBrokerSettlements').reportingSettlements(groups);
   for(const trade of rows) {
    trade.broker_settlement=pooled.get(trade.id);
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
  if(req.user?.id){await refreshAccountResults(req.user.id);const rates=await require('../utils/tradeFx').getUsdRateMap();req.accountFxKey=require('crypto').createHash('sha256').update(JSON.stringify(rates||{})).digest('hex').slice(0,16);if(lastReportingFx.get(req.user.id)!==req.accountFxKey){await AnalyticsCache.invalidate(req.user.id);lastReportingFx.set(req.user.id,req.accountFxKey);}req.accountReports=new Map((await db.query('SELECT trade_id,result FROM trade_account_reports WHERE user_id=$1',[req.user.id])).rows.map(r=>[r.trade_id,r.result]));}
  next();
 }catch(error){next(error);}
}
module.exports={refreshAccountResults,reportAccountPnl};
