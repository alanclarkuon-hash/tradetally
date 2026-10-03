import {describe,it,expect} from 'vitest'
import {valueChartPoints} from './portfolioValueChart'
describe('portfolio value history',()=>{
  it('shows missing recorded dates as gaps, without inventing values',()=>{
    const points=valueChartPoints([{date:'2026-01-01',value:100},{date:'2026-01-03',value:130}])
    expect(points.map(p=>p.y)).toEqual([100,null,130])
  })
  it('keeps partial dates null and consecutive observations connected',()=>{
    expect(valueChartPoints([{date:'2026-01-01',value:100},{date:'2026-01-02',value:null},{date:'2026-01-03',value:110}]).map(p=>p.y)).toEqual([100,null,110])
  })
})
