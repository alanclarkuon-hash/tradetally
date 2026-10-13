const provider=require('./holdingsHistoryProvider');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');
function firstDate(symbol,payload) {
 const listing=payload?.listing,meta=listing?.meta;
 if(listing?.source!=='yahoo'||!meta?.exchangeName||!Number.isFinite(meta.firstTradeDate)||meta.firstTradeDate<=0)return null;
 try {
  provider.verifyYahooListing(symbol,meta);
  if(normaliseMinorUnit(meta.currency)?.code!==payload.currency)return null;
  const day=provider.yahooSessionDate(meta.firstTradeDate,meta);
  return day>='1900-01-01'&&day<=new Date().toISOString().slice(0,10)?day:null;
 }catch{return null;}
}
function trimPadding(task,requiredFrom,payload) {
 const first=firstDate(task.symbol,payload);
 // Earlier real holdings indicate an older/reused listing, never optional padding.
 if(task.instrumentType==='stock'&&first&&requiredFrom&&requiredFrom>=first&&task.from<first&&first<=task.to)return {...task,from:first};
 return task;
}
module.exports={firstDate,trimPadding};
