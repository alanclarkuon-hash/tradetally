const {catalogueSymbols}=require('./brokerSync/trading212Instruments');
const cache=require('../utils/cache');
const pending=new Map();
async function resolvePlanningSymbols(client,userId,account,symbol){
 const exact=[String(symbol||'').trim().toUpperCase()];
 if(account?.broker!=='trading212')return exact;
 const saved=await require('./brokerInstrumentSymbols').catalogueForAccount(client,userId,account.account_identifier);
 if(saved)return catalogueSymbols(saved,exact[0]);
 const connections=(await client.query("SELECT DISTINCT c.id FROM broker_connections c JOIN trades t ON t.broker_connection_id=c.id WHERE c.user_id=$1 AND t.user_id=$1 AND t.account_identifier=$2 AND c.broker_type='trading212'",[userId,account.account_identifier])).rows;
 if(connections.length!==1)return exact;
 const id=connections[0].id,key='planning_instruments:'+userId+':'+id;
 let catalogue=cache.get(key);
 if(!catalogue){
  if(!pending.has(key))pending.set(key,(async()=>{
   const connection=await require('../models/BrokerConnection').findById(id,true);
   if(!connection||connection.userId!==userId)throw Error('Instrument catalogue owner mismatch');
   const items=await require('./brokerSync/trading212Service').fetchInstruments(connection);
   if(!Array.isArray(items))throw Error('Invalid broker instrument catalogue');
   cache.set(key,items,60*60*1000);return items;
  })().finally(()=>pending.delete(key)));
  try{catalogue=await pending.get(key)}catch{return exact}
 }
 return catalogueSymbols(catalogue,exact[0]);
}
module.exports={catalogueSymbols,resolvePlanningSymbols};
