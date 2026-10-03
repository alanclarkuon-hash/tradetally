// Squarified rectangles preserve holding area without producing long strips.
// Group rectangles use canvas pixels; holdings use parent percentages.
// An asset's company name must never determine its coordinate system.
export function heatmapRectStyle(rect, canvas = false) {
  return {left:(canvas?rect.x/10:rect.x)+'%',top:(canvas?rect.y/5.6:rect.y)+'%',
    width:(canvas?rect.w/10:rect.w)+'%',height:(canvas?rect.h/5.6:rect.h)+'%'}
}

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

// Nest once, preserving each holding's value and keeping cash/stablecoins out
// of this layout (the dashboard supplies invested holdings only).
export function holdingGroups(holdings, box={x:0,y:0,w:1000,h:560}) {
  const partition=(items,key)=>{
    const groups=new Map()
    for(const item of items){const name=key(item)||'Unclassified';const group=groups.get(name)||{name,value:0,items:[]};group.value+=item.value||0;group.items.push(item);groups.set(name,group)}
    return [...groups.values()]
  }
  return treemap(partition(holdings,h=>h.assetClass||h.industry),box).map(g=>{
    const height=Math.max(g.h-26,1)
    const normalize=t=>({...t,x:t.x/g.w*100,y:t.y/height*100,w:t.w/g.w*100,h:t.h/height*100,area:t.w*t.h,pixelW:t.w})
    const tileIn=c=>{
      const header=Math.min(18,c.h/3)
      return treemap(c.items,{x:c.x,y:c.y+header,w:c.w,h:Math.max(c.h-header,.01)}).map(normalize)
    }
    if(g.name==='Stocks') {
      const sectors=treemap(partition(g.items,h=>h.sector),{x:0,y:0,w:g.w,h:height})
      const categories=sectors.flatMap(s=>{
        const header=Math.min(22,s.h/3)
        return treemap(partition(s.items,h=>h.industry),{x:s.x,y:s.y+header,w:s.w,h:Math.max(s.h-header,.01)}).map(c=>({...c,key:s.name+' / '+c.name}))
      })
      return {...g,sectors:sectors.map(s=>({...normalize(s),labelHeight:Math.min(22,s.h/3)/s.h*100})),categories:categories.map(c=>({...normalize(c),labelHeight:Math.min(18,c.h/3)/height*100,showLabel:c.h>=42 && c.w>=65})),tiles:categories.flatMap(tileIn)}
    }
    if(['Crypto assets','Funds & ETFs'].includes(g.name)) {
      const categories=treemap(partition(g.items,h=>h.category),{x:0,y:0,w:g.w,h:height})
      return {...g,sectors:[],categories:categories.map(c=>({...normalize(c),labelHeight:Math.min(18,c.h/3)/height*100,showLabel:c.h>=42 && c.w>=65})),tiles:categories.flatMap(tileIn)}
    }
    return {...g,sectors:[],categories:[],tiles:treemap(g.items,{x:0,y:0,w:g.w,h:height}).map(normalize)}
  })
}
