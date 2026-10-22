// Additional execution rows belong to management, never the finalised definition.
function definitionForManagement(plan) {
 const definition=plan.definition;
 return {...definition,...Object.fromEntries(['entry','exit'].map(action=>{
  const field=action==='entry'?'entries':'exits',rows=definition[field]||[],keys=new Set(rows.map(r=>r.key));
  const added=Object.entries(plan.management?.[action]||{}).filter(([key,row])=>!keys.has(key)&&row.stage).map(([key,row])=>({key,...row.stage,price:row.price,units:row.units,percent:row.percent,premium:row.premium,tactics:row.tactics||[],marketContext:row.marketContext||[]}));
  return [field,[...rows,...added]];
 }))};
}
function forManagement(plan){return {...plan,definition:definitionForManagement(plan)};}
module.exports={definitionForManagement,forManagement};
