// Squarified rectangles preserve holding area without producing long strips.
export function treemap(items, box) {
  const sorted = items.filter(x => x.value > 0).sort((a,b) => b.value-a.value)
  const total = sorted.reduce((s,x) => s+x.value,0)
  if (!total) return []
  const remaining = sorted.map(item => ({item,area:item.value/total*box.w*box.h}))
  const result = []
  let rect = {...box}, row = []
  const worst = (r, side) => {
    if (!r.length) return Infinity
    const sum=r.reduce((s,x)=>s+x.area,0), areas=r.map(x=>x.area)
    return Math.max(side*side*Math.max(...areas)/(sum*sum),sum*sum/(side*side*Math.min(...areas)))
  }
  const place = () => {
    const area=row.reduce((s,x)=>s+x.area,0), vertical=rect.w>=rect.h
    const breadth=area/(vertical?rect.h:rect.w)
    let offset=0
    for (const x of row) {
      const length=x.area/breadth
      result.push({...x.item,x:rect.x+(vertical?0:offset),y:rect.y+(vertical?offset:0),w:vertical?breadth:length,h:vertical?length:breadth})
      offset+=length
    }
    if(vertical){rect.x+=breadth;rect.w-=breadth}else{rect.y+=breadth;rect.h-=breadth}
    row=[]
  }
  while(remaining.length){
    const next=remaining[0],side=Math.min(rect.w,rect.h)
    if(!row.length || worst([...row,next],side)<=worst(row,side)){row.push(remaining.shift())}else place()
  }
  if(row.length)place()
  return result
}

export function pnlColor(percent) {
  if(percent==null || !Number.isFinite(percent))return '#394451'
  if(percent===0)return '#47515c'
  const strength=Math.min(Math.abs(percent)/35,1)
  const from=percent>=0?[29,70,52]:[90,40,45],to=percent>=0?[119,218,155]:[139,18,38]
  return `rgb(${from.map((v,i)=>Math.round(v+(to[i]-v)*strength)).join(',')})`
}
