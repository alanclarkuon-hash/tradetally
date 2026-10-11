const db=require('../config/database');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');
function groupChoices(rows){
 const grouped={};
 for(const row of rows){
  const code=normaliseMinorUnit(row.currency)?.code;
  if(!/^[A-Z]{3}$/.test(code||''))continue;
  const account=row.account_identifier||'__unsorted__';
  if(!grouped[account])grouped[account]=[];
  if(!grouped[account].includes(code))grouped[account].push(code);
 }
 for(const values of Object.values(grouped))values.sort();
 return grouped;
}
async function forUser(userId){
 const rows=(await db.query(`WITH owned AS (SELECT * FROM trades WHERE user_id=$1), currencies AS (
 SELECT account_identifier,original_currency AS currency FROM owned
 UNION SELECT t.account_identifier,s.currency FROM owned t JOIN symbol_categories s ON s.symbol=COALESCE(t.underlying_symbol,t.symbol)
 UNION SELECT t.account_identifier,e->>'currency' FROM owned t CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.executions)='array' THEN t.executions ELSE '[]'::jsonb END) e
 UNION SELECT a.account_identifier,p.definition->>'currency' FROM trade_plans p LEFT JOIN user_accounts a ON a.user_id=p.user_id AND a.id::text=p.definition->>'accountId' WHERE p.user_id=$1
 UNION SELECT b.account_identifier,p->'instrument'->>'currency' FROM broker_portfolio_snapshots b CROSS JOIN LATERAL jsonb_array_elements(b.positions) p WHERE b.user_id=$1
 ) SELECT DISTINCT account_identifier,currency FROM currencies WHERE currency IS NOT NULL`,[userId])).rows;
 return groupChoices(rows);
}
module.exports={forUser,groupChoices};
