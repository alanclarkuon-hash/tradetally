// Read-only coverage: reuse verified saved prices without downloads or cache writes.
const db=require('../config/database');
const cache=require('../utils/historicalPriceCache');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');
const calendar=require('./exchangeCalendar');
const {missingRanges}=require('./holdingsHistoryProvider');
async function remaining(gap) {
 if(gap.unsupported)return gap;
 const ranges=gap.ranges||[];
 if(!ranges.length)return gap;
 const from=gap.from||ranges[0].from,to=gap.to||ranges.at(-1).to;
 const venue=gap.calendar||await calendar.resolve(gap.symbol,{from,to});
 const crypto=gap.instrumentType==='crypto';
 const candles=(await cache.getRange(crypto?'crypto:'+gap.symbol:gap.symbol,from,to)).filter(c=>Number.isFinite(c.time)&&Number.isFinite(c.close)&&c.close>0);
 const payload=(await db.query('SELECT payload FROM portfolio_reconstruction_prices WHERE symbol=$1',[crypto?gap.symbol+'-USD':gap.symbol])).rows[0]?.payload;
 const unit=normaliseMinorUnit(payload?.currency);
 if(unit&&Array.isArray(payload?.prices)) {
   const rates=unit.code==='USD'?new Map():new Map((await db.query("SELECT rate_date,rates FROM fx_daily_rates WHERE base_code='USD' AND rate_date BETWEEN $1 AND $2",[from,to])).rows.map(r=>[new Date(r.rate_date).toISOString().slice(0,10),r.rates]));
   const proxies=new Set(payload.proxyDates||[]);
   for(const p of payload.prices) {
     if(p.date<from||p.date>to||proxies.has(p.date)||!Number.isFinite(Number(p.close))||!(Number(p.close)>0))continue;
     if(unit.code==='USD'||Number(rates.get(p.date)?.[unit.code])>0)candles.push({time:Date.parse(p.date)/1000});
   }
 }
 const missing=ranges.flatMap(r=>missingRanges(candles,r.from,r.to,crypto,venue));
 if(!missing.length)return null;
 return {...gap,calendar:venue,ranges:missing,reason:crypto?'No finalized broker/provider prices for these dates':calendar.coversRange(venue,from,to)?'No prices returned for expected exchange sessions':'No prices returned; exchange calendar is unavailable for some requested dates'};
}
module.exports={remaining};
