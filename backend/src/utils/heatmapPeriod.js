// Date filters name the first included day. Its opening basis is the daily
// close before that day, never that day's changing candle.
function previousDay(date) {
  const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}
module.exports={previousDay};
function sessionOnOrBefore(date,calendar,crypto=false) {
  if(crypto)return date;
  for(let i=0;i<=14;i++) {
    if(require('../services/exchangeCalendar').isTradingDay(date,calendar))return date;
    date=previousDay(date);
  }
  return null;
}
module.exports.sessionOnOrBefore=sessionOnOrBefore;
