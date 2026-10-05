const {CRYPTO_TO_COINGECKO}=require('./cryptoAssets');
const ids=new Set(Object.values(CRYPTO_TO_COINGECKO));
function mergeCategoryCache(existing,incoming){
 if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))throw Error('Invalid category cache');
 const result={...existing};
 for(const [id,record] of Object.entries(incoming)){
  if(!ids.has(id)||!record||!Array.isArray(record.categories)||!Number.isFinite(Date.parse(record.asOf)))throw Error('Invalid category record');
  if(record.categories.some(c=>typeof c!=='string'||!c.trim()||c.length>250))throw Error('Invalid category label');
  const categories=[...new Set(record.categories.map(c=>c.trim()))];
  if(!categories.length)continue;
  if(result[id]?.categories?.length&&Date.parse(result[id].asOf)>=Date.parse(record.asOf))continue;
  result[id]={categories,asOf:record.asOf};
 }
 return result;
}
module.exports={mergeCategoryCache};
