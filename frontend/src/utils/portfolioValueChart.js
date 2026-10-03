export const dateNumber=date=>Date.parse(date+'T12:00:00Z')
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
