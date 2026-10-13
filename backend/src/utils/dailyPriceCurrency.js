const {normaliseMinorUnit}=require('./quoteCurrency');
async function toUsd(candles,currency=null) {
  const result=[];
  const datedRates=new Map();
  if((candles||[]).some(c=>{const unit=normaliseMinorUnit(c.currency||currency);return unit&&unit.code!=='USD';})) {
    const dates=candles.map(c=>new Date(c.time*1000).toISOString().slice(0,10)).sort();
    const rows=(await require('../config/database').query("SELECT rate_date,rates FROM fx_daily_rates WHERE base_code='USD' AND rate_date BETWEEN $1 AND $2",[dates[0],dates.at(-1)])).rows;
    for(const row of rows)if(row.rates)datedRates.set(new Date(row.rate_date).toISOString().slice(0,10),row.rates);
  }
  for(const candle of candles||[]) {
    const unit=normaliseMinorUnit(candle.currency||currency);
    if(!unit || !(Number(candle.close)>0))continue;
    const date=new Date(candle.time*1000).toISOString().slice(0,10);
    const cached=Number(datedRates.get(date)?.[unit.code]);
    const rate=unit.code==='USD'?1:cached>0?1/cached:await require('./currencyConverter').getForexRate(unit.code,'USD',date);
    if(!(rate>0))continue;
    const factor=rate/unit.divisor;
    result.push({...candle,open:Number(candle.open??candle.close)*factor,high:Number(candle.high??candle.close)*factor,
      low:Number(candle.low??candle.close)*factor,close:Number(candle.close)*factor,currency:'USD'});
  }
  return result;
}
module.exports={toUsd};
