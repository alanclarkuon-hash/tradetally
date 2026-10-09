const names={units:'Quantity',price:'Price level',percent:'Exit percentage',premium:'Option premium',tactics:'Tactic tags',marketContext:'Market context tags'}
const quantity=value=>value==null?'—':Number(value).toLocaleString('en-GB',{maximumFractionDigits:6})
const money=(value,currency)=>value==null?'—':new Intl.NumberFormat('en-GB',{style:'currency',currency:currency||'USD',maximumFractionDigits:2}).format(value)
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null)
const value=(field,v,currency)=>field==='units'&&v==null?'Calculated':['price','premium'].includes(field)?money(v,currency):Array.isArray(v)?v.join(', ')||'None':quantity(v)+(field==='percent'?'%':'')
export function describeManagementEvent(event,definition={}){
 const s=event.snapshot||{},currency=s.currency||definition.currency||'USD'
 const rowName=(kind,key)=>(definition[kind==='entry'?'entries':'exits']||[]).find(r=>r.key===key)?.label||key
 if(event.event_type==='management_updated'){
  const actions=[]
  for(const kind of ['entry','exit'])for(const key of new Set([...Object.keys(s.previous?.[kind]||{}),...Object.keys(s.next?.[kind]||{})])){
   const before=s.previous?.[kind]?.[key],after=s.next?.[kind]?.[key],label=rowName(kind,key),action=kind==='entry'?'Entry':'Exit'
   if(!after){actions.push({title:action+' row removed · '+label,detail:''});continue}
   if(!!before?.executed!==!!after.executed)actions.push({title:action+(after.executed?' marked as executed':' execution mark removed')+' · '+label,detail:after.executed?quantity(after.units)+' units @ '+money(after.price,currency)+' · User-reported execution':''})
   if(!before)continue
   for(const field of Object.keys(names))if(!same(before[field],after[field]))actions.push({title:action+' '+names[field].toLowerCase()+' changed · '+label,detail:value(field,before[field],currency)+' → '+value(field,after[field],currency)})
  }
  return actions
 }
 if(event.event_type==='trade_linked')return [{title:(s.action==='exit'?'Exit':'Entry')+' trade linked · '+rowName(s.action||'entry',s.stageKey),detail:quantity(s.quantity)+' units @ '+money(s.source?.price,s.source?.currency||currency)}]
 if(event.event_type==='trade_unlinked')return [{title:(s.allocation?.action==='exit'?'Exit':'Entry')+' trade link removed',detail:s.reason||''}]
 if(event.event_type==='stop_changed')return [{title:'SL invalidation level changed',detail:money(s.previous,currency)+' → '+money(s.next,currency)+(s.reason?' · '+s.reason:'')}]
 if(event.event_type==='option_rolled')return [{title:'Option rolled for credit',detail:(s.netCredit!=null?money(s.netCredit,currency)+' · ':'')+(s.reason||'')}]
 if(event.event_type==='entry_committed')return [{title:'Entry committed · '+(s.stage?.label||'Awaiting execution'),detail:s.reason||''}]
 if(event.event_type==='commitment_released')return [{title:'Unfilled entry commitment released',detail:s.reason||''}]
 return []
}
