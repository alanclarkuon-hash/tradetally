const {cents}=require('./igStatement');
const signature=r=>JSON.stringify([r.time,cents(r.cash),r.type,r.description]);
function merge(records,emailRecords=[]){
 const aliases=new Map(),combined=[...records],ids=new Map(records.map(r=>[r.reference,r]));
 for(const e of emailRecords){
  if(!e.reference?.startsWith('email:')||e.source!=='ig_email'||!['deposit','withdrawal','interest','dividend','tax','account_fee','transfer_in','transfer_out'].includes(e.type))throw Error('Invalid IG email cash evidence');
  const sameId=ids.get(e.reference);
  if(sameId){if(signature(sameId)!==signature(e))throw Error('Conflicting IG email cash evidence');continue;}
  const matches=records.filter(r=>signature(r)===signature(e));
  if(matches.length>1)throw Error('Ambiguous IG email cash counterpart');
  if(matches.length===1){aliases.set(e.reference,matches[0].reference);continue;}
  const {reportedBalance,source,...record}=e;combined.push(record);ids.set(e.reference,record);
 }
 return {records:combined.sort((a,b)=>a.time.localeCompare(b.time)||a.reference.localeCompare(b.reference)),aliases};
}
module.exports={merge,signature};
