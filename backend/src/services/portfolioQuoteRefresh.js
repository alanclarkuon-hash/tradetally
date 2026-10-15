const db=require('../config/database');
async function read(query={}) {
  const currency=String(query.currency||'USD').toUpperCase();
  const keys=[...new Set(String(query.symbols||'').split(',').filter(Boolean))];
  if(!/^[A-Z]{3}$/.test(currency)||keys.length>250||keys.some(k=>! /^(crypto:)?[A-Za-z0-9.^=_!/-]{1,32}$/.test(k))) {
    const error=Error('Invalid quote refresh request');error.status=400;throw error;
  }
  const [quotes,rates]=await Promise.all([
    keys.length?db.query('SELECT symbol,current_price,last_updated,data_source,quote_session,timestamp_kind FROM price_monitoring WHERE symbol=ANY($1)',[keys]):{rows:[]},
    require('../utils/displayCurrency').getRatesToDisplay(['USD'],currency)
  ]);
  if(!(rates.USD>0))throw Error('Display currency conversion is unavailable');
  return {asOf:new Date().toISOString(),currency,usdRate:rates.USD,quotes:quotes.rows,
    monitoring:require('./priceMonitoringService').getStatus()};
}
module.exports={read};
