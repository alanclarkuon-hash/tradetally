const converter=require('../utils/currencyConverter');
const db=require('../config/database');
let cached,pending;
// One current quote serves every open planning workspace for five minutes.
async function latestPlanningFx(){
 if(cached&&Date.now()-cached.timestamp<300000)return cached.value;
 if(pending)return pending;
 pending=(async()=>{let value;
  try{
   const rates={USD:1,...await converter.getRateMap('USD')};
   try{const gbp=await converter.getForexRate('USD','GBP');if(Number.isFinite(gbp)&&gbp>0)rates.GBP=gbp;}catch{/* Keep the available current map. */}
   value={rates,fetchedAt:new Date().toISOString(),source:'current_quote'};
  }catch{
   value=(await db.query("SELECT rates,rate_date FROM fx_daily_rates WHERE base_code='USD' ORDER BY rate_date DESC LIMIT 1")).rows[0]||null;
   if(value)value={...value,rates:{USD:1,...value.rates},source:'stored_fallback'};
  }
  if(value)cached={value,timestamp:Date.now()};return value;
 })();try{return await pending}finally{pending=null}
}
module.exports={latestPlanningFx};
