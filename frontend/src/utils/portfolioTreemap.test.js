import { describe, it, expect } from 'vitest'
import { treemap, pnlColor, holdingGroups } from './portfolioTreemap'
describe('portfolio heatmap',()=>{
  it('preserves values as areas with no overlap or overflow',()=>{
    const result=treemap([8,5,3,2,1].map((value,i)=>({symbol:String(i),value})),{x:0,y:0,w:1000,h:560})
    for(const r of result){
      expect(r.w*r.h).toBeCloseTo(r.value/19*560000,5)
      expect(r.x+r.w).toBeLessThanOrEqual(1000.00001)
      expect(r.y+r.h).toBeLessThanOrEqual(560.00001)
      for(const other of result.filter(o=>o!==r))expect(Math.min(r.x+r.w,other.x+other.w)-Math.max(r.x,other.x)<1e-8 || Math.min(r.y+r.h,other.y+other.h)-Math.max(r.y,other.y)<1e-8).toBe(true)
    }
  })
  it('omits unpriced assets rather than inventing tile areas',()=>expect(treemap([{value:null},{value:0}],{x:0,y:0,w:100,h:100})).toEqual([]))
  it('separates missing P&L from gains and losses',()=>{expect(pnlColor(null)).not.toBe(pnlColor(0));expect(pnlColor(-20)).not.toBe(pnlColor(20))})
  it('nests stocks by sector and industry without duplicating holdings',()=>{
    const holdings=[{symbol:'MSFT',assetClass:'Stocks',sector:'Information Technology',industry:'Software',value:100},{symbol:'NVDA',assetClass:'Stocks',sector:'Information Technology',industry:'Semiconductors',value:80},{symbol:'LLY',assetClass:'Stocks',sector:'Health Care',industry:'Pharmaceuticals',value:60},{symbol:'NEAR',assetClass:'Crypto assets',category:'AI',value:50},{symbol:'ETF.L',assetClass:'Funds & ETFs',category:'Technology',value:40}]
    const groups=holdingGroups(holdings),stocks=groups.find(g=>g.name==='Stocks')
    expect(stocks.sectors.map(s=>s.name).sort()).toEqual(['Health Care','Information Technology'])
    expect(stocks.categories.map(c=>c.name).sort()).toEqual(['Pharmaceuticals','Semiconductors','Software'])
    expect(groups.flatMap(g=>g.tiles).map(t=>t.symbol).sort()).toEqual(holdings.map(h=>h.symbol).sort())
    expect(groups.reduce((sum,g)=>sum+g.value,0)).toBe(330)
    for(const g of groups)for(const tile of g.tiles){expect(tile.x+tile.w).toBeLessThanOrEqual(100.00001);expect(tile.y+tile.h).toBeLessThanOrEqual(100.00001)}
  })
})
