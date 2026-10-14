const axios = require('axios');
const cheerio = require('cheerio');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');
const routes = { L:['lon','GBP'], HK:['hkg','HKD'], F:['fra','EUR'], DE:['etr','EUR'], OL:['osl','NOK'] };
const memo = new Map();
let queue=Promise.resolve(),nextRequest=0,cooldownUntil=0;
async function get(url,options) {
 const task=queue.then(async()=>{
  if(Date.now()<cooldownUntil)throw Error('Stock Analysis rate-limit cooldown');
  const delay=nextRequest-Date.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));
  nextRequest=Date.now()+3000;
  try{return await axios.get(url,options);}catch(error){
   if(error.response?.status===429){const value=error.response.headers?.['retry-after'],seconds=Number(value);cooldownUntil=Date.now()+Math.max(120000,Number.isFinite(seconds)&&seconds>0?seconds*1000:Date.parse(value)-Date.now()||120000);}
   throw error;
  }
 });queue=task.catch(()=>{});return task;
}
async function page(path) {
 let url='https://stockanalysis.com'+path;
 for(let n=0;n<3;n++) {
  try{return (await get(url,{timeout:15000,maxRedirects:0,maxContentLength:8*1024*1024})).data;}
  catch(e){if(![301,302,307,308].includes(e.response?.status)||!e.response.headers?.location)throw e;const target=new URL(e.response.headers.location,url);if(target.origin!=='https://stockanalysis.com')throw Error('Unexpected history-page redirect');url=target.href;}
 }
 throw Error('Too many history-page redirects');
}
// Only literal hydration data is read. Never execute scripts supplied by a site.
function literalObject(text, start) {
 let i=start, depth=0, quoted=false, escaped=false;
 for(;i<text.length;i++) { const c=text[i]; if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&!--depth)return text.slice(start,i+1); }
 throw Error('Incomplete public listing metadata');
}
function stringField(text,key) {
 const m=text.match(new RegExp('(?:^|[,\\{])'+key+':("(?:[^"\\\\]|\\\\.)*")'));
 return m?JSON.parse(m[1]):null;
}
function route(symbol) {
 const name=String(symbol).toUpperCase(),m=/^(.+)\.(L|HK|F|DE|OL)$/.exec(name);
 if(m){const [venue,currency]=routes[m[2]],ticker=m[2]==='HK'?m[1].replace(/^0(?=\d{4}$)/,''):m[1];return {path:`/quote/${venue}/${ticker}/history/`,ticker,venue:venue.toUpperCase(),currency,type:'a'};}
 const ticker=name.replace(/\.US$/,'');
 if(!/^[A-Z][A-Z0-9.-]*$/.test(ticker)||ticker.endsWith('.OLD')||ticker.includes('.'))throw Error('Stock Analysis listing namespace unavailable');
 return {path:`/stocks/${ticker.toLowerCase()}/history/`,ticker,currency:'USD',type:'s'};
}
async function download(symbol) {
 const key=String(symbol).toUpperCase();
 if(memo.has(key)&&Date.now()-memo.get(key).time<3600000)return memo.get(key).promise;
 const promise=(async()=>{
  const r=route(symbol);let html;
  try{html=await page(r.path);}catch(e){if(e.response?.status!==404||r.type!=='s')throw e;r.path='/etf/'+r.ticker.toLowerCase()+'/history/';html=await page(r.path);}
  const pos=html.indexOf('info:{');if(pos<0)throw Error('Public listing identity missing');
  const info=literalObject(html,pos+5),ticker=stringField(info,'ticker')||stringField(info,'symbol'),exchange=stringField(info,'exchange_code')||stringField(info,'exchange'),curr=info.match(/curr:\{([^}]+)\}/)?.[1],priceCurrency=stringField('{'+curr+'}','price'),unit=normaliseMinorUnit(priceCurrency),currency=unit?.code;
  if(ticker?.toUpperCase()!==r.ticker||(!unit||!(r.venue==='LON'?['GBP','USD']: [r.currency]).includes(currency))||(r.venue&&exchange!==r.venue)||(!r.venue&&!/^(NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|TXSE|OTC|OTCQX|OTCQB|OTCPK)$/i.test(exchange||'')))throw Error('Stock Analysis listing identity mismatch');
  const uid=stringField(info,'db_symbol')||stringField(info,'uid')||ticker;
  const type=stringField(info,'type')?.charAt(0);if(!['s','e','a'].includes(type))throw Error('Unsupported public listing type');
  const response=(await get(`https://api.stockanalysis.com/api/symbol/${type}/${encodeURIComponent(uid)}/history`,{params:{range:'5Y',period:'Daily'},timeout:20000,maxRedirects:0,maxContentLength:8*1024*1024})).data;
  if(!Array.isArray(response.data))throw Error('Public daily history unavailable');
  const source=html.match(/data:\{data:\{[^{}]*source:"([^"]+)"/)?.[1];if(!['tiingo','spg','spg-api'].includes(source))throw Error('Unverified historical-price source');
  const rows=response.data.filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.t)&&[p.o,p.h,p.l,p.c].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)&&p.h>=Math.max(p.o,p.l,p.c)&&p.l<=Math.min(p.o,p.h,p.c)&&Number(p.v)>1);
  return {symbol:key,ticker,exchange,currency,name:stringField(info,'nameFull'),path:r.path,source:'stockanalysis:'+source,basis:'split-adjusted-close',prices:rows.map(p=>({date:p.t,close:p.c/unit.divisor})),candles:rows.map(p=>({time:Date.parse(p.t)/1000,open:p.o/unit.divisor,high:p.h/unit.divisor,low:p.l/unit.divisor,close:p.c/unit.divisor,volume:p.v,currency}))};
 })();
 memo.set(key,{time:Date.now(),promise});promise.catch(error=>{if(error.response?.status===429||error.message==='Stock Analysis rate-limit cooldown')memo.delete(key);else if(error.response?.status>=500||error.code==='ECONNABORTED'){const entry=memo.get(key);if(entry)entry.time=Date.now()-55*60000;}});if(memo.size>256)memo.delete(memo.keys().next().value);return promise;
}
// Provider split dates are calendar labels, not local-midnight timestamps.
// Accept explicit ISO or English month labels only; never normalize bad dates.
function parseCalendarDate(value) {
 if(typeof value!=='string')return null;
 const text=value.trim(),iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
 const label=/^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(text);
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 const month=iso?Number(iso[2]):label?months.findIndex(m=>m===label[1].toLowerCase()||m.slice(0,3)===label[1].toLowerCase())+1:0;
 const year=Number(iso?.[1]||label?.[3]),day=Number(iso?.[3]||label?.[2]);
 if(!(year>=1000&&year<=9999&&month>=1&&month<=12&&day>=1&&day<=31))return null;
 const date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null;
}
async function splitProof(data) {
 if(!data.proofPromise)data.proofPromise=(async()=>{
  const html=await page(data.path.replace(/history\/$/,'statistics/'));
  const pos=html.indexOf('info:{');if(pos<0)return;
  const info=literalObject(html,pos+5),ticker=stringField(info,'ticker')||stringField(info,'symbol');
  const curr=info.match(/curr:\{([^}]+)\}/)?.[1],unit=normaliseMinorUnit(stringField('{'+curr+'}','price'));
  if(ticker?.toUpperCase()!==data.ticker||stringField(info,'nameFull')!==data.name||(stringField(info,'exchange_code')||stringField(info,'exchange'))!==data.exchange||unit?.code!==data.currency)return;
  const $=cheerio.load(html),fields=new Map();
  for(const tr of $('tr').toArray()){const cells=$(tr).find('td');if(cells.length===2)fields.set($(cells[0]).text().trim(),$(cells[1]).text().trim());}
  const last=fields.get('Last Split Date'),type=fields.get('Split Type'),ratio=fields.get('Split Ratio');
  if(last==='n/a'&&type==='n/a'&&ratio==='n/a'&&$('main').text().includes('This stock does not have any record of stock splits.'))data.unadjustedAfter='1900-01-01';
  else if(ratio&&ratio!=='n/a'){const calendarDate=parseCalendarDate(last);if(calendarDate)data.unadjustedAfter=calendarDate;}
 })().catch(()=>{});
 await data.proofPromise;
}
// Native dated quotes are the reference for both security continuity and split
// basis. Only fill near an independently verified overlap; never overwrite it.
function verifiedRows(data,from,to,cached) {
 if((cached?.prices?.length&&!cached.currency)||(cached?.currency&&cached.currency!==data.currency))return [];
 const existing=new Map((cached?.prices||[]).map(p=>[p.date,p.close]));
 const merger=require('./verifiedMergerPriceBasis'),conversion=merger.conversionFor(data),continuity=merger.proof(data,cached);
 const splits=cached?.splits||[];
 const factor=d=>splits.filter(s=>s.date>d).reduce((v,s)=>v*s.ratio,1);
 const anchors=data.prices.filter(p=>existing.has(p.date)&&Math.abs(existing.get(p.date)/(p.close*factor(p.date))-1)<=0.02).map(p=>p.date).sort();
 return data.prices.filter(p=>p.date>=from&&p.date<=to&&(!conversion||p.date<conversion.date)&&!existing.has(p.date)&&(merger.covers(data.ticker,p.date,continuity)||anchors.some(d=>Math.abs(Date.parse(d)-Date.parse(p.date))<=3*86400000)||(data.unadjustedAfter&&p.date>=data.unadjustedAfter&&!splits.some(s=>s.date>p.date)))).map(p=>({...p,close:p.close*factor(p.date)}));
}
async function verified(symbol,from,to,cached) {
 const data=await download(symbol);
 if(verifiedRows(data,from,to,cached).length<data.prices.filter(p=>p.date>=from&&p.date<=to).length)await splitProof(data);
 const prices=verifiedRows(data,from,to,cached);
 const dates=new Set(prices.map(p=>p.date));
 const {proofPromise,...publicData}=data;
 const historicalIdentity=require('./verifiedMergerPriceBasis').proof(data,cached)||require('./verifiedListingTransfers').proof(data,cached);
 return {...publicData,...(historicalIdentity?{historicalIdentity}:{}),prices,candles:data.candles.filter(c=>dates.has(new Date(c.time*1000).toISOString().slice(0,10)))};
}
module.exports={download,verified,verifiedRows,splitProof,route,literalObject,stringField,parseCalendarDate};
