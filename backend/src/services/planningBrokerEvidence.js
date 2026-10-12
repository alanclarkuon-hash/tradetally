const {fail}=require('./tradePlanning');
const fresh=(date,minutes,now=Date.now())=>{const t=Date.parse(date);return Number.isFinite(t)&&t<=now+60000&&now-t<=minutes*60000};
async function recheck(client,userId,d,stage){
 const id=require('./planningAccounts').stageAccount(d,'entry',stage.key);
 const account=(await client.query('SELECT account_identifier,broker FROM user_accounts WHERE id=$1 AND user_id=$2',[id,userId])).rows[0];
 if(!account)fail('Selected broker account is unavailable');
 if(d.direction==='short'&&(account.broker==='trading212'&&d.instrument==='stock'||['okx','kraken'].includes(account.broker)&&d.instrument==='crypto'))fail('This broker integration supports owned spot holdings, not borrowed short entries');
 const saved=(id===d.accountId?d.constraints:d.accountConstraints?.[id])||{};
 let broker;try{broker=await require('./planningConstraints').resolve(client,userId,account,{...d,pair:saved.pair})}catch{broker={source:account.broker,coverage:'Broker evidence unavailable; current verification required'}};
 const rules={...saved,...broker};
 // A stale holdings snapshot cannot prove remaining capacity. Preserve a known maximum as a restriction.
 const holdingsFresh=fresh(broker.holdingsAsOf,15),rulesFresh=fresh(broker.asOf,1440);
 if(!holdingsFresh)rules.currentQuantity=null;
 for(const [key,description,breach] of [['minimumQuantity','minimum quantity',v=>stage.quantity<v],['maximumQuantity','maximum quantity',v=>stage.quantity>v],['minimumValue','minimum trade value',v=>stage.positionValue!=null&&stage.positionValue<v]])if(rules[key]!=null&&breach(rules[key]))fail('Broker '+description+' would be breached');
 if(rules.quantityStep>0&&Math.abs(stage.quantity/rules.quantityStep-Math.round(stage.quantity/rules.quantityStep))>1e-6)fail('Entry quantity does not meet the broker quantity increment');
 return {rules,source:rules.source||'Manual broker rules',rulesAsOf:broker.asOf||saved.asOf||null,holdingsAsOf:broker.holdingsAsOf||null,rulesFresh,holdingsFresh,coverage:broker.coverage||'Unverified',workingStopVerified:false,borrowingVerified:false};
}
module.exports={fresh,recheck};
