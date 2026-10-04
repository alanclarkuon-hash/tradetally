export const dateNumber=date=>Date.parse(date+'T12:00:00Z')
// The first complete closing balance is the baseline; movements on that day
// are already included. Missing FX prevents a reliable adjusted value onward.
export function fundingAdjustedHistory(history) {
  const ordered=[...(history?.series||[])].sort((a,b)=>a.date.localeCompare(b.date))
  const baseline=ordered.find(point=>point.value!=null)
  if(!baseline)return {series:ordered,change:null,baselineDate:null}
  const events=(history.events||[]).filter(event=>['deposit','withdrawal','transfer'].includes(event.type)&&event.date>baseline.date).sort((a,b)=>a.date.localeCompare(b.date))
  let index=0,netFunding=0,missingFunding=Boolean(history.coverage?.unavailableAccounts?.length)
  const series=ordered.map(point=>{
    while(index<events.length&&events[index].date<=point.date){
      const event=events[index++]
      if(event.amount==null||!Number.isFinite(event.amount))missingFunding=true
      else netFunding+=event.amount
    }
    return {...point,portfolioValue:point.value,netFunding,missingFunding,value:point.value==null||missingFunding?null:Math.round((point.value-baseline.value-netFunding)*100)/100}
  })
  const complete=series.filter(point=>point.portfolioValue!=null)
  return {series,change:complete.length>=2?complete.at(-1).value:null,baselineDate:baseline.date}
}
export function valueChartPoints(series) {
  const result=[]
  let previous=null
  for(const point of series) {
    const x=dateNumber(point.date)
    if(previous!=null&&x-previous>86400000)result.push({x:previous+86400000,y:null})
    result.push({...point,x,y:point.value})
    previous=x
  }
  return result
}
