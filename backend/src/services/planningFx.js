const converter=require('../utils/currencyConverter');
const db=require('../config/database');
let cached,pending;
// Share the reporting rate map with Trades and Dashboard; never override one
// currency with an independent spot quote after account cash P/L is established.
async function latestPlanningFx(){
 if(cached&&Date.now()-cached.timestamp<300000)return cached.value;
 if(pending)return pending;
 pending=(async()=>{let value;
  try{
   const rates={USD:1,...await converter.getRateMap('USD')};
   value={rates,fetchedAt:new Date().toISOString(),source:'current_quote'};
  }catch{
   value=(await db.query("SELECT rates,rate_date FROM fx_daily_rates WHERE base_code='USD' ORDER BY rate_date DESC LIMIT 1")).rows[0]||null;
   if(value)value={...value,rates:{USD:1,...value.rates},source:'stored_fallback'};
  }
  if(value)cached={value,timestamp:Date.now()};return value;
 })();try{return await pending}finally{pending=null}
}
module.exports={latestPlanningFx};
