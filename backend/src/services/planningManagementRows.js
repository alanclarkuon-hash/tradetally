// Additional execution rows belong to management, never the finalised definition.
function definitionForManagement(plan) {
 const definition=plan.definition;
 return {...definition,...Object.fromEntries(['entry','exit'].map(action=>{
  const field=action==='entry'?'entries':'exits',rows=definition[field]||[],keys=new Set(rows.map(r=>r.key));
  const added=Object.entries(plan.management?.[action]||{}).filter(([key,row])=>!keys.has(key)&&row.stage).sort(([,a],[,b])=>(a.position??Number.MAX_SAFE_INTEGER)-(b.position??Number.MAX_SAFE_INTEGER)).map(([key,row])=>({key,...row.stage,price:row.price,units:row.units,percent:row.percent,premium:row.premium,tactics:row.tactics||[],marketContext:row.marketContext||[]}));
  return [field,[...rows,...added]];
 }))};
}
function forManagement(plan){return {...plan,definition:definitionForManagement(plan)};}
// Older clients may omit display metadata. Keep positions they already saved.
function preservePositions(previous,management){
 for(const action of ['entry','exit'])for(const [key,row]of Object.entries(management[action]||{})){
  const position=previous?.[action]?.[key]?.position;
  if(row.position==null&&Number.isInteger(position))row.position=position;
 }
 return management;
}
module.exports={definitionForManagement,forManagement,preservePositions};
