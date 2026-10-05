const db = require('../config/database');
const DAY = 86400000;
const iso = value => new Date(value).toISOString().slice(0, 10);
const date = (year, month, day) => Date.UTC(year, month - 1, day);
const nth = (year, month, weekday, n) => {
  const first = date(year, month, 1);
  return first + ((weekday - new Date(first).getUTCDay() + 7) % 7 + (n - 1) * 7) * DAY;
};
const lastMonday = (year, month) => {
  const last = date(year, month + 1, 0);
  return last - (new Date(last).getUTCDay() + 6) % 7 * DAY;
};
function easter(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  return date(year, Math.floor((h+l-7*m+114)/31), (h+l-7*m+114)%31+1);
}
const nearestWeekday = t => t + (new Date(t).getUTCDay() === 6 ? -DAY : new Date(t).getUTCDay() === 0 ? DAY : 0);
const nextWeekday = t => { while ([0,6].includes(new Date(t).getUTCDay())) t+=DAY; return t; };
// Rules cover imported modern history. Exceptional full closures are explicit;
// early closes and bank-only holidays deliberately remain trading sessions.
// Sources and supported history are documented in HISTORICAL_PRICE_BACKFILL.md.
const calendars = new Map();
calendars.set('US', year => {
  const days = [date(year,1,1),nth(year,1,1,3),nth(year,2,1,3),easter(year)-2*DAY,
    lastMonday(year,5),nearestWeekday(date(year,7,4)),nth(year,9,1,1),nth(year,11,4,4),nearestWeekday(date(year,12,25))];
  // NYSE does not observe Saturday New Year's Day on the preceding Friday.
  if (new Date(days[0]).getUTCDay()===0) days[0]+=DAY;
  if (year>=2022) days.push(nearestWeekday(date(year,6,19)));
  if (year===2025) days.push(date(year,1,9)); // National day of mourning.
  return days;
});
calendars.set('LSE', year => {
  const days=[nextWeekday(date(year,1,1)),easter(year)-2*DAY,easter(year)+DAY,
    year===2020 ? date(year,5,8) : nth(year,5,1,1),lastMonday(year,5),lastMonday(year,8)];
  if(year===2022) { days[4]=date(year,6,2); days.push(date(year,6,3),date(year,9,19)); }
  if(year===2023) days.push(date(year,5,8));
  const occupied=new Set();
  for(const t of [date(year,12,25),date(year,12,26)]) {
    let observed=nextWeekday(t); while(occupied.has(observed)) observed=nextWeekday(observed+DAY);
    occupied.add(observed); days.push(observed);
  }
  return days;
});
calendars.set('XETRA', year => [date(year,1,1),easter(year)-2*DAY,easter(year)+DAY,
  date(year,5,1),date(year,12,24),date(year,12,25),date(year,12,26),date(year,12,31),
  ...(year<=2021 ? [easter(year)+50*DAY,date(year,10,3)] : [])]);
const holidays=new Map(), identities=new Map(), lookupLanes=new Map(), retryAfter=new Map(), verifiedListings=new Set();
let yahooLane=Promise.resolve(), yahooCooldown=0;
function isTradingDay(day, calendar) {
  const t=Date.parse(day),year=new Date(t).getUTCFullYear();
  if(!Number.isFinite(t) || [0,6].includes(new Date(t).getUTCDay())) return false;
  if(!calendars.has(calendar) || year<2020) return true;
  const key=`${calendar}:${year}`;
  if(!holidays.has(key)) holidays.set(key,new Set(calendars.get(calendar)(year).map(iso)));
  return !holidays.get(key).has(day);
}
function identify(symbol, exchange='') {
  symbol=String(symbol).toUpperCase(); exchange=String(exchange).toUpperCase();
  if(symbol.endsWith('.L')) return 'LSE';
  if(symbol.endsWith('.DE')) return 'XETRA';
  // Never apply US holidays just because a ticker has no suffix.
  if(/LONDON|^LSE$|^XLON$|^LSEETF$/.test(exchange)) return 'LSE';
  if(/XETRA|^XET$|^GER$|^XETR$/.test(exchange)) return 'XETRA';
  if(/NASDAQ|NYSE|NEW YORK STOCK|BATS|^XNYS$|^XNAS$|^ARCX$|^NMS$|^NGM$|^NCM$|^NYQ$|^PCX$|^ASE$|^BTS$|^SNP$|^DJI$/.test(exchange)) return 'US';
  return null;
}
async function lookup(symbol) {
  if(Date.now()<yahooCooldown || Date.now()<(retryAfter.get(symbol)||0)) return null;
  if(lookupLanes.has(symbol)) return lookupLanes.get(symbol);
  const request=yahooLane.catch(()=>{}).then(async()=>{
    if(Date.now()<yahooCooldown) return null;
    await new Promise(resolve=>setTimeout(resolve,500));
    const ticker=symbol==='BRK.B'?'BRK-B':symbol;
    try {
      const response=await require('axios').get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,{
        params:{range:'5d',interval:'1d'},timeout:12000,maxRedirects:0,maxContentLength:1024*1024,
        headers:{'User-Agent':'TradeTally exchange calendar metadata'}
      });
      const meta=response.data?.chart?.result?.[0]?.meta;
      if(String(meta?.symbol).toUpperCase()!==ticker.toUpperCase() || !meta.exchangeName) throw Error('Listing metadata unavailable');
      await db.query(`INSERT INTO exchange_calendar_listings(symbol,exchange,source) VALUES($1,$2,'yahoo')
        ON CONFLICT(symbol) DO UPDATE SET exchange=EXCLUDED.exchange,source=EXCLUDED.source,checked_at=NOW()`,[symbol,meta.exchangeName]);
      const value=identify(symbol,meta.exchangeName);
      verifiedListings.add(symbol);
      identities.set(symbol,{value:Promise.resolve(value),expires:Date.now()+3600000});
      retryAfter.set(symbol,Date.now()+86400000);
      return value;
    } catch(error) {
      if([429,999].includes(error.response?.status)) yahooCooldown=Date.now()+Math.max(60,Number(error.response.headers?.['retry-after'])||60)*1000;
      retryAfter.set(symbol,Date.now()+3600000); return null;
    }
  });
  yahooLane=request; lookupLanes.set(symbol,request);
  try{return await request;}finally{lookupLanes.delete(symbol);}
}
async function resolve(symbol,{allowLookup=false}={}) {
  symbol=String(symbol).toUpperCase();
  const suffix=identify(symbol); if(suffix) return suffix;
  const old=identities.get(symbol);
  if(old && Date.now()<old.expires) {
    const known=await old.value;
    return known || (allowLookup && !verifiedListings.has(symbol) ? lookup(symbol) : null);
  }
  const value=(async()=>{
    const saved=(await db.query(`SELECT exchange,source FROM exchange_calendar_listings WHERE symbol=$1
      UNION ALL SELECT exchange,'classification' AS source FROM symbol_categories WHERE symbol=$1`,[symbol])).rows;
    const listing=saved.find(row=>row.source==='yahoo');
    if(listing) { verifiedListings.add(symbol); return identify(symbol,listing.exchange); }
    return saved.map(row=>identify(symbol,row.exchange)).find(Boolean)||null;
  })();
  identities.set(symbol,{value,expires:Date.now()+3600000});
  if(identities.size>4096) identities.delete(identities.keys().next().value);
  try { const known=await value; return known || (allowLookup && !verifiedListings.has(symbol) ? lookup(symbol) : null); }
  catch {identities.delete(symbol);return null;}
}
module.exports={resolve,identify,isTradingDay,calendars};
