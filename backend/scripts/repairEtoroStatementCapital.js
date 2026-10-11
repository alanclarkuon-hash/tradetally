// One-off owner/account-scoped metadata repair. Default is read-only preview.
const db=require('../src/config/database');
const {recoverCashCapital,entryCapital}=require('../src/services/etoroCapital');
async function repair(apply=false){
 const client=await db.connect(),counts={eligible:0,updated:0,alreadyPresent:0,unresolved:0};
 try{
  await client.query('BEGIN');
  const reports=(await client.query("SELECT DISTINCT ON(r.user_id,r.account_id) r.*,a.account_identifier FROM broker_cash_reports r JOIN user_accounts a ON a.id=r.account_id AND a.user_id=r.user_id WHERE r.broker_type='etoro' AND r.currency='USD' AND a.broker='etoro' ORDER BY r.user_id,r.account_id,r.to_date DESC,r.updated_at DESC")).rows;
  for(const report of reports){
   const records=typeof report.records==='string'?JSON.parse(report.records):report.records,byPosition=new Map();
   for(const r of records){if(r.sourceType!=='Position closed'||!r.positionId)continue;const id=String(r.positionId);if(!byPosition.has(id))byPosition.set(id,[]);byPosition.get(id).push(r);}
   const trades=(await client.query("SELECT * FROM trades WHERE user_id=$1 AND broker='etoro' AND account_identifier=$2 AND exit_time IS NOT NULL FOR UPDATE",[report.user_id,report.account_identifier])).rows;
   for(const t of trades){
    const es=typeof t.executions==='string'?JSON.parse(t.executions):t.executions||[];
    if(!es[0]?.etoro_statement_source)continue;
    if(entryCapital(t)!=null){counts.alreadyPresent++;continue;}
    const capital=recoverCashCapital(t,byPosition.get(String(es[0].etoro_position_id))||[]);
    if(capital==null){counts.unresolved++;continue;}counts.eligible++;
    if(!apply)continue;
    const updated=es.map(e=>e.action===(t.side==='short'?'sell':'buy')?{...e,etoro_invested_capital:capital,etoro_capital_currency:'USD',etoro_capital_basis:'statement_close_cash_and_reported_net'}:e);
    await client.query('UPDATE trades SET executions=$1::jsonb,updated_at=NOW() WHERE id=$2 AND user_id=$3',[JSON.stringify(updated),t.id,t.user_id]);counts.updated++;
   }
   if(apply&&counts.updated)await client.query('DELETE FROM analytics_cache WHERE user_id=$1',[report.user_id]);
  }
  await client.query(apply?'COMMIT':'ROLLBACK');return counts;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
if(require.main===module)repair(process.argv.includes('--apply')).then(r=>{console.log(JSON.stringify(r));return db.pool.end()}).catch(e=>{console.error(e.message);process.exit(1)});
module.exports={repair};
