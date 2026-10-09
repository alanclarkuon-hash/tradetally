export const planningStages = [
 {key:'draft',label:'Draft'}, {key:'ready',label:'Ready'},
 {key:'watching',label:'Watching'}, {key:'entered',label:'Entered'},
 {key:'under_review',label:'Under review'}, {key:'reviewed',label:'Reviewed'},
 {key:'completed',label:'Completed'}, {key:'cancelled',label:'Cancelled'}
]
export const planStatusLabel = status => planningStages.find(s=>s.key===status)?.label || status
const valid = value => value && Number.isFinite(Date.parse(value))
const earliest = values => values.filter(valid).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]
export function planMilestones(plan,history=[],ledger={}) {
 const dates=new Map(planningStages.map(s=>[s.key,[]]))
 const add=(stage,date)=>{if(dates.has(stage)&&valid(date))dates.get(stage).push(date)}
 const lastExitRecorded=history.filter(e=>(e.event_type==='trade_linked'&&e.snapshot?.action==='exit')
  ||(e.event_type==='management_updated'&&Object.values(e.snapshot?.next?.exit||{}).some(r=>r.executed)))
  .map(e=>e.created_at).filter(valid).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]
 add('draft',plan.created_at)
 for(const e of history) {
  const snapshot=e.snapshot||{}
  if(e.event_type==='created')add('draft',e.created_at)
  if(dates.has(e.event_type))add(e.event_type,e.created_at)
  if(dates.has(snapshot.status))add(snapshot.status,e.created_at)
  if(e.event_type==='trade_linked'&&snapshot.action==='entry')add('entered',snapshot.source?.time||e.created_at)
  if(e.event_type==='management_updated') {
   const entries=Object.values(snapshot.next?.entry||{}).filter(r=>r.executed)
   for(const entry of entries)add('entered',entry.time||e.created_at)
  }
  if(e.event_type==='review_reopened')add('under_review',e.created_at)
  // Older review events do not store the resulting status. Only infer the
  // transition once all exposure has exited and a review draft followed it.
  if(e.event_type==='review_draft_saved'&&(plan.status==='under_review'||ledger.economicallyClosed)
   &&lastExitRecorded&&Date.parse(e.created_at)>=Date.parse(lastExitRecorded))add('under_review',e.created_at)
 }
 return planningStages.filter(s=>s.key!=='cancelled'||plan.status==='cancelled'||dates.get(s.key).length)
  .map(s=>{const timestamp=earliest(dates.get(s.key));return {...s,current:plan.status===s.key,timestamp,
   date:timestamp?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(timestamp)):'Pending'}})
}
