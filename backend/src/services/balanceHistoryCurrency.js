// Reporting conversion only: native snapshots are never rewritten.
function balanceHistoryCurrency(rows, rates = {}) {
 const perUsd={USD:1,...rates}, days=new Map(), sourceCurrencies=new Set();
 for(const row of rows){
  const date=row.snapshot_date instanceof Date?row.snapshot_date.toISOString().slice(0,10):row.snapshot_date;
  const currency=String(row.iso_currency_code||'').toUpperCase();
  if(currency)sourceCurrencies.add(currency);
  const rate=Number(perUsd[currency]);
  if(!days.has(date))days.set(date,{date,currentBalance:0,availableBalance:0,accountCount:0,missingFx:0});
  const point=days.get(date),count=Number(row.account_count)||0;
  point.accountCount+=count;
  if(!(rate>0)){point.missingFx+=count||1;point.currentBalance=null;point.availableBalance=null;continue;}
  for(const [key,column] of [['currentBalance','current_balance'],['availableBalance','available_balance']]){
   if(row[column]==null||!Number.isFinite(Number(row[column])))point[key]=null;
   else if(point[key]!=null)point[key]+=Number(row[column])/rate;
  }
 }
 const series=[...days.values()];
 return {currency:'USD',series,coverage:{missingFx:series.reduce((sum,p)=>sum+p.missingFx,0),sourceCurrencies:[...sourceCurrencies]}};
}
module.exports={balanceHistoryCurrency};
