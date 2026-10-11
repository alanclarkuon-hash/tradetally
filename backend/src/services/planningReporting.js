// Presentation only: account-native cash evidence remains in the allocation ledger.
// Cross-account display conversion never rewrites source fills or broker FX.
function project(result,d,fx){
 if(!(result.accounts?.length>1))return result;
 const rates={USD:1,...fx?.rates},cross=(from,to)=>from===to?1:rates[from]>0&&rates[to]>0?rates[to]/rates[from]:null;
 const currency=result.currency||d.currency,accountCurrency=d.currency;
 const records=result.records.map(a=>{
  const original=a.fill,priceRate=cross(original.currency,currency);
  const accountRate=cross(a.accountCurrency,accountCurrency);
  if(!priceRate)return {...a,presentationUnavailable:true};
  const fill={...original,price:original.price*priceRate,economicPrice:original.economicPrice==null?undefined:original.economicPrice*priceRate,currency,costs:original.costs*priceRate,commission:(original.commission||0)*priceRate,fees:(original.fees||0)*priceRate,netFees:original.netFees==null?undefined:original.netFees*priceRate,netCosts:original.netCosts==null?undefined:original.netCosts*priceRate,displaySource:{price:original.price,currency:original.currency,transactionFx:original.transactionFx},transactionFx:original.transactionFx&&accountRate?{accountCurrency,rate:original.transactionFx.rate*priceRate/accountRate}:null};
  return {...a,fill,realisedProfit:a.realisedProfit==null?null:a.realisedProfit*priceRate,accountCurrency,sourceAccountCurrency:a.accountCurrency,accountRealisedProfit:a.accountRealisedProfit==null||!accountRate?null:a.accountRealisedProfit*accountRate};
 });
 if(records.some(a=>a.presentationUnavailable))return result;
 const ready=result.coverageComplete&&!result.costsUnresolved&&result.accounts.every(a=>a.positionValue!=null&&a.realisedProfit!=null&&cross(a.currency,accountCurrency));
 const sum=key=>result.accounts.reduce((v,a)=>v+a[key]*cross(a.currency,accountCurrency),0),profit=ready?sum('realisedProfit'):null,entryCost=ready?sum('entryCost'):null;
 return {...result,currency,records,displayConversion:true,displayFx:fx,accountCurrency,accountRealisedProfit:profit,accountEntryCost:entryCost,accountPositionValue:ready?sum('positionValue'):null,accountAveragePrice:ready&&result.openQuantity>0?sum('positionValue')/result.openQuantity/(d.instrument==='option'?d.options.multiplier:1):null,accountPercentGain:ready&&entryCost>0?profit/entryCost*100:null,accountRealisedR:ready&&d.riskBudget>0?profit/d.riskBudget:null,realisedProfit:records.every(a=>a.action!=='exit'||a.realisedProfit!=null)?records.filter(a=>a.action==='exit').reduce((v,a)=>v+a.realisedProfit,0):null};
}
module.exports={project};
