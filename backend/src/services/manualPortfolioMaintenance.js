// Statement values commit with the ledger. Reconstruction is derived data;
// failure must not make a successful financial import look unsuccessful.
const pending=new Map();
async function rebuild(userId,broker,identifiers,fromDate) {
 const prior=pending.get(userId)||Promise.resolve();
 const job=prior.catch(()=>{}).then(async()=>{
  try {
   const rebuilt=await require('./portfolioReconstructionService').reconstruct(userId,{
    broker,accountIdentifiers:identifiers,fromDate,fetchPrices:false,apply:true,zeroMissingPrices:true});
   const historyJobId=await require('./historyBackfillService').enqueue(userId);
   return {historyJobId,rebuilt:rebuilt.reduce((n,r)=>n+r.days,0),warnings:rebuilt.some(r=>r.gaps)
    ?['Some historical dates remain estimated or unavailable. Statement values have been saved.']:[]};
  } catch {
   return {rebuilt:0,warnings:['Statement values were saved, but historical reconstruction could not finish. Refresh the portfolio to see confirmed values.']};
  }
 });
 pending.set(userId,job);
 try{return await job;}finally{if(pending.get(userId)===job)pending.delete(userId);}
}
module.exports={rebuild};
