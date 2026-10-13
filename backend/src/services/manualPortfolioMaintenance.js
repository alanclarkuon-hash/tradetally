// Financial imports commit independently of derived history maintenance.
const pending=new Map();
async function rebuild(userId,broker,identifiers,fromDate) {
 const prior=pending.get(userId)||Promise.resolve();
 const job=prior.catch(()=>{}).then(async()=>{
  const result={failed:false,rebuilt:0,warnings:[]};
  try {
   const rows=await require('./portfolioReconstructionService').reconstruct(userId,{broker,accountIdentifiers:identifiers,fromDate,fetchPrices:false,apply:true,zeroMissingPrices:true});
   result.rebuilt=rows.reduce((n,r)=>n+r.days,0);
   if(rows.some(r=>r.gaps))result.warnings.push('Some historical dates remain estimated or unavailable. Statement values have been saved.');
  } catch {result.failed=true;result.warnings.push('Statement values were saved, but historical reconstruction could not finish. Refresh the portfolio to see confirmed values.');}
  try {result.historyJobId=await require('./historyBackfillService').enqueue(userId,{accounts:Object.fromEntries(identifiers.map(id=>[id,fromDate||null]))});} catch {result.warnings.push('Statement values were saved, but background history could not be queued. Retry the history update.');}
  return result;
 });
 pending.set(userId,job);
 try{return await job;}finally{if(pending.get(userId)===job)pending.delete(userId);}
}
module.exports={rebuild};
