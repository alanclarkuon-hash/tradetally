
const levels=[.05,.1,.2,.3];
function recommend(selected,events){
 const defaulted=selected==null;
 let index=levels.indexOf(defaulted?.3:selected),wins=0,losses=0,eligible=0,excluded=0;
 if(index<0)return {level:null,eligible:0,excluded:events.length,reason:'Select an applied exposure level'};
 for(const e of [...events].sort((a,b)=>String(a.time).localeCompare(String(b.time)))){
  if(!e.eligible||!Number.isFinite(e.r)){wins=0;losses=0;excluded++;continue}
  eligible++;
  if(e.r>.05){wins++;losses=0;if(wins===3){index=Math.min(levels.length-1,index+1);wins=0}}
  else if(e.r<-.05){losses++;wins=0;if(losses===5){index=Math.max(0,index-1);losses=0}}
 }
 return {level:levels[index],eligible,excluded,wins,losses,defaulted,reason:defaulted?'Starting recommendation defaults to 0.3%; your applied level remains unset':'Completed system plans after your last level selection; recommendations do not change the applied level'};
}
module.exports={recommend};
