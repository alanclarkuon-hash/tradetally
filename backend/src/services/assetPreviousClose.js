const db=require('../config/database');
const calendar=require('./exchangeCalendar');
const {priceCacheKey}=require('../utils/priceCacheIdentity');
const identity=require('./cryptoHistoryIdentity');
const {previousDay,sessionOnOrBefore}=require('../utils/heatmapPeriod');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');

// Saved evidence only. A missing expected session must not become an older close.
async function readPreviousClose(symbol,type,{now=new Date(),timeZone='UTC'}={}) {
  let today;
  try {today=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
  catch {today=now.toISOString().slice(0,10);}
  const crypto=type==='crypto',exchange=crypto?null:await calendar.resolve(symbol);
  if(!crypto&&!exchange)return {status:'calendar_unavailable',sessionDate:null};
  const sessionDate=sessionOnOrBefore(previousDay(today),exchange,crypto);
  const key=identity.historyKey(priceCacheKey(symbol,type));
  const row=(await db.query(`SELECT close,price_currency,is_final,data_source,
    COALESCE(updated_at,created_at) AT TIME ZONE 'UTC' AS saved_at
    FROM historical_prices WHERE symbol=$1 AND price_date=$2`,[key,sessionDate])).rows[0];
  const base={sessionDate,status:!row?'missing':!row.is_final?'provisional':row.price_currency!=='USD'?'unverified_currency':!(Number(row.close)>0)?'invalid':!crypto&&(['coingecko','okx','kraken'].includes(row.data_source)||/^broker:[^:]+:crypto$/.test(row.data_source||''))?'identity_unverified':'available'};
  if(base.status!=='available')return base;
  const result={...base,amount:Number(row.close),currency:'USD',source:row.data_source,savedAt:row.saved_at,marketTimestamp:null,nativeEquivalent:null};
  const raw=(await db.query('SELECT payload FROM portfolio_reconstruction_prices WHERE symbol=$1',[identity.nativeKey(crypto?symbol+'-USD':symbol)])).rows[0]?.payload;
  const unit=normaliseMinorUnit(raw?.currency);
  if(unit&&unit.code!=='USD'){
    const fx=(await db.query("SELECT rate_date::text,rates FROM fx_daily_rates WHERE base_code='USD' AND rate_date<=$1 ORDER BY rate_date DESC LIMIT 1",[sessionDate])).rows[0];
    const rate=require('../utils/heatmapCurrency').datedDisplayRate(fx?[fx]:[],unit.code)(sessionDate);
    result.nativeCurrency=unit.code;
    if(rate>0)result.nativeEquivalent={amount:result.amount*rate,currency:unit.code,usdRate:rate,fxDate:fx.rate_date};
  }
  return result;
}
module.exports={readPreviousClose};
