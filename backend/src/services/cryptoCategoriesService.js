const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const {CRYPTO_TO_COINGECKO} = require('../utils/cryptoAssets');

const file = path.join(__dirname, '../data/coingecko-categories.json');
const DAY = 86400000;
let records, loading, queue = Promise.resolve(), nextRequest = 0, cooldown = 0;

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
  return {categories,primaryCategory:primaryCategory(categories),source:'CoinGecko',asOf:record?.asOf||null,stale:!record || Date.now()-Date.parse(record.asOf)>DAY};
}
async function getCategories(symbol) {
  const id=CRYPTO_TO_COINGECKO[String(symbol).toUpperCase()];
  if(!id)return result(null);
  await load();
  if(records[id] && Date.now()-Date.parse(records[id].asOf)<DAY)return result(records[id]);
  const job=queue.then(async()=>{
    if(records[id] && Date.now()-Date.parse(records[id].asOf)<DAY)return result(records[id]);
    if(Date.now()<cooldown)return result(records[id]);
    const delay=Math.max(0,nextRequest-Date.now());
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    nextRequest=Date.now()+3000;
    try {
      const headers=process.env.COINGECKO_API_KEY?{'x-cg-demo-api-key':process.env.COINGECKO_API_KEY}:{};
      const response=await axios.get(`https://api.coingecko.com/api/v3/coins/${id}`,{headers,timeout:10000,params:{localization:false,tickers:false,market_data:false,community_data:false,developer_data:false}});
      if(response.data?.id!==id || !Array.isArray(response.data.categories))return result(records[id]);
      records[id]={categories:cleanCategories(response.data.categories),asOf:new Date().toISOString()};
      try {await persist();} catch {console.warn('[CRYPTO-CATEGORIES] Disk cache unavailable; labels retained in memory');}
    } catch(error) {
      // Never hammer the provider or discard previously fetched labels.
      cooldown=Date.now()+(error.response?.status===429?15*60000:60000);
      console.warn(`[CRYPTO-CATEGORIES] Category lookup paused (${error.response?.status || error.code || 'network error'})`);
    }
    return result(records[id]);
  });
  queue=job.catch(()=>{});
  return job;
}
module.exports={getCategories,cleanCategories,primaryCategory};
