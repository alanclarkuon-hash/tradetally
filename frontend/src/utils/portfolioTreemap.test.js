import { describe, it, expect } from 'vitest'
import { treemap, pnlColor } from './portfolioTreemap'
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
})
