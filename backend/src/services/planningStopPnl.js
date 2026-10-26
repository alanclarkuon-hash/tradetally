// Display projection only. Keep non-negative capacity risk and original R unchanged.
function calculate(plan,result,rates={}){
 const currency=plan.definition.currency,unavailable={amount:null,currency};
 if(result.unresolved||result.overExit||result.costsUnresolved||!['stock','crypto','cfd'].includes(plan.definition.instrument))return unavailable;
 const stop=Number(plan.definition.stopPrice);if(!(stop>0))return unavailable;
 if(!(result.openQuantity>1e-8))return {amount:0,currency};
 if(!result.openLots?.length)return unavailable;
 const fx={USD:1,...rates},cross=(from,to)=>from===to?1:fx[from]>0&&fx[to]>0?fx[to]/fx[from]:null;
 let amount=0;
 for(const lot of result.openLots){
  const conversion=cross(currency,lot.accountCurrency);
  if(!conversion||lot.accountPrice==null||!Number.isFinite(lot.accountPrice)||!(lot.multiplier>0))return unavailable;
  const level=stop*conversion*lot.multiplier;
  amount+=lot.q*(lot.side==='short'?lot.accountPrice-level:level-lot.accountPrice)/conversion;
 }
 return {amount:Math.abs(amount)<1e-10?0:amount,currency};
}
module.exports={calculate};
