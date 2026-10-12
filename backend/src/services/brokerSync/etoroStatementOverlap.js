// Revised statement presentation may differ while economic activity is unchanged.
// Keep original references and cash rows; never turn historical revisions into new events.
const withdrawals=new Set(['Withdraw Request','Transfer: USD > GBP','Withdrawal Conversion Fee']);
const blank=v=>v==null||v===''||v==='-';
const cashEqual=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=.000001;
const exact=(a,b)=>['reference','time','sourceType','type','amount','positionId'].every(k=>a[k]===b[k])&&cashEqual(a.cash,b.cash);
const split=(a,b)=>a.sourceType==='corp action: Split'&&b.sourceType===a.sourceType&&a.time===b.time&&a.type===null&&b.type===null&&a.amount===0&&b.amount===0&&a.cash===0&&b.cash===0&&typeof a.details==='string'&&a.details.length>0&&a.details===b.details;
const withdrawal=r=>withdrawals.has(r.sourceType)&&blank(r.positionId)&&Number.isFinite(r.amount)&&r.amount<=0&&r.cash<=0&&r.type===(r.sourceType==='Withdrawal Conversion Fee'?null:'withdrawal');
const signature=r=>JSON.stringify([r.sourceType==='Withdrawal Conversion Fee'?'fee':'withdrawal',r.amount]);
function verify(old,next){
 let revisions=0;
 for(let i=0;i<old.length;i++){
  if(exact(old[i],next[i]))continue;
  if(split(old[i],next[i])){revisions++;continue;}
  let start=i,end=i+1;
  while(start>0&&withdrawals.has(old[start-1].sourceType)&&old[start-1].time===old[i].time)start--;
  while(end<old.length&&withdrawals.has(old[end].sourceType)&&old[end].time===old[i].time)end++;
  const a=old.slice(start,end),b=next.slice(start,end);
  const paired=a.some(r=>r.sourceType==='Withdrawal Conversion Fee')&&a.some(r=>r.type==='withdrawal');
  if(paired&&a.every(withdrawal)&&b.every(withdrawal)&&a.every((r,n)=>r.time===b[n].time&&cashEqual(r.cash,b[n].cash))&&JSON.stringify(a.map(signature).sort())===JSON.stringify(b.map(signature).sort())){
   revisions+=a.filter((r,n)=>!exact(r,b[n])).length;i=end-1;continue;
  }
  throw Error('eToro upload: Previously imported activity differs from this statement. No records have been changed.');
 }
 return revisions;
}
module.exports={verify};
