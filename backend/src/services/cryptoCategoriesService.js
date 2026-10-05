const client = require('./coinGeckoClient');
const identity = require('./coinGeckoIdentityService');
const fs = require('fs/promises');
const path = require('path');

const file = path.join(__dirname, '../data/coingecko-categories.json');
const DAY = 7 * 86400000;
let records, loading, queue = Promise.resolve();
const displayRefreshes = new Map();

function cleanCategories(categories) {
  return Array.isArray(categories) ? [...new Set(categories.filter(c => typeof c==='string' && c.trim()).map(c=>c.trim()))] : [];
}
function primaryCategory(categories) {
  // One display group per coin prevents counting multi-category assets twice.
  // All source labels are retained; this priority is a display convention.
  const priorities = ['Artificial Intelligence (AI)','Real World Assets (RWA)','Decentralized Finance (DeFi)','Meme','Layer 2 (L2)','Layer 1 (L1)'];
  for(const name of priorities)if(categories.includes(name))return name;
  return categories.find(c=>!/(ecosystem|portfolio|holdings|index|securities|made in|proof of|cryptocurrency)/i.test(c)) || null;
}
async function load() {
  if(records)return;
  if(!loading)loading=(async()=>{
    try {records=JSON.parse(await fs.readFile(file,'utf8'));} catch {records={};}
  })();
  await loading;
}
async function persist() {
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file+'.tmp',JSON.stringify(records));
  await fs.rename(file+'.tmp',file);
}
function result(record) {
  const categories=cleanCategories(record?.categories);
  return {categories,primaryCategory:primaryCategory(categories),logo:cleanLogo(record?.logo),source:'CoinGecko',asOf:record?.asOf||null,stale:!record || Date.now()-Date.parse(record.asOf)>DAY};
}
function cleanLogo(value) {
  try {const url=new URL(value);return url.protocol==='https:' && ['assets.coingecko.com','coin-images.coingecko.com'].includes(url.hostname) ? url.href : null;} catch {return null;}
}
async function getCategories(symbol, {requireLogo=false}={}) {
  const id=(await identity.resolve(symbol))?.id;
  if(!id)return result(null);
  await load();
  if(records[id] && (!requireLogo || cleanLogo(records[id].logo)) && Date.now()-Date.parse(records[id].asOf)<DAY)return result(records[id]);
  const job=queue.then(async()=>{
    if(records[id] && (!requireLogo || cleanLogo(records[id].logo)) && Date.now()-Date.parse(records[id].asOf)<DAY)return result(records[id]);
    try {
      const response=await client.get(`/coins/${id}`,{ttl:DAY,params:{localization:false,tickers:false,market_data:false,community_data:false,developer_data:false}});
      if(response.data?.id!==id || !Array.isArray(response.data.categories))return result(records[id]);
      const categories=cleanCategories(response.data.categories);
      const logo=cleanLogo(response.data.image?.small || response.data.image?.large || response.data.image?.thumb);
      // An empty provider response must not erase previously known labels.
      if(!categories.length && !logo)return result(records[id]);
      records[id]={...records[id],categories:categories.length?categories:records[id]?.categories||[],
        asOf:categories.length?new Date().toISOString():records[id]?.asOf||new Date().toISOString(),
        logo:logo||records[id]?.logo||null};
      try {await persist();} catch {console.warn('[CRYPTO-CATEGORIES] Disk cache unavailable; labels retained in memory');}
    } catch(error) {
      // Never hammer the provider or discard previously fetched labels.
      console.warn('[CRYPTO-CATEGORIES] Metadata unavailable; cached labels and logos retained');
    }
    return result(records[id]);
  });
  queue=job.catch(()=>{});
  return job;
}
async function getCachedCategories(symbol) {
  await load();
  const record=records[(await identity.cached(symbol))?.id];
  return record ? result(record) : null;
}
async function getDisplayCategories(symbol) {
  const cached = await getCachedCategories(symbol);
  const key = String(symbol).trim().toUpperCase();
  if ((!cached || cached.stale) && !displayRefreshes.has(key)) {
    // Metadata refreshes share the provider budget but must not hold up balances.
    const refresh = getCategories(key).catch(() => null)
      .finally(() => displayRefreshes.delete(key));
    displayRefreshes.set(key, refresh);
  }
  return cached || result(null);
}
async function getLogo(symbol) {
  const cached=await getCachedCategories(symbol);
  if(cached?.logo)return cached.logo;
  const lookup=getCategories(symbol,{requireLogo:true}).then(value=>value.logo).catch(()=>null);
  // Shared queue continues warming the cache; logo reads must not block a page.
  let timer;
  try {return await Promise.race([lookup,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1200);})]);}
  finally {clearTimeout(timer);}
}
module.exports={getCategories,getCachedCategories,getDisplayCategories,getLogo,cleanLogo,cleanCategories,primaryCategory};
