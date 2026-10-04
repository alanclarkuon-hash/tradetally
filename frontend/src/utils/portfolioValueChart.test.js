import {describe,it,expect} from 'vitest'
import {valueChartPoints,fundingAdjustedHistory} from './portfolioValueChart'
describe('portfolio value history',()=>{
  it('shows missing recorded dates as gaps, without inventing values',()=>{
    const points=valueChartPoints([{date:'2026-01-01',value:100},{date:'2026-01-03',value:130}])
    expect(points.map(p=>p.y)).toEqual([100,null,130])
  })
  it('keeps partial dates null and consecutive observations connected',()=>{
    expect(valueChartPoints([{date:'2026-01-01',value:100},{date:'2026-01-02',value:null},{date:'2026-01-03',value:110}]).map(p=>p.y)).toEqual([100,null,110])
  })
})

describe('Funding-adjusted gains',()=>{
  it('removes signed deposits, withdrawals and transfers after the first closing value',()=>{
    const history={series:[{date:'2026-01-01',value:100},{date:'2026-01-02',value:220},{date:'2026-01-03',value:170},{date:'2026-01-04',value:205}],events:[{date:'2026-01-01',type:'deposit',amount:100},{date:'2026-01-02',type:'deposit',amount:100},{date:'2026-01-03',type:'withdrawal',amount:-60},{date:'2026-01-04',type:'transfer',amount:30}]}
    const result=fundingAdjustedHistory(history)
    expect(result.series.map(point=>point.value)).toEqual([0,20,30,35])
    expect(result.change).toBe(35)
    expect(history.series[1].value).toBe(220)
  })
  it('includes funding on missing-value dates and preserves gaps',()=>{
    const result=fundingAdjustedHistory({series:[{date:'2026-01-01',value:100},{date:'2026-01-02',value:null},{date:'2026-01-03',value:210}],events:[{date:'2026-01-02',type:'deposit',amount:100}]})
    expect(result.series.map(point=>point.value)).toEqual([0,null,10])
  })
  it('keeps all later gains unavailable after an unconverted funding movement',()=>{
    const result=fundingAdjustedHistory({series:[{date:'2026-01-01',value:100},{date:'2026-01-02',value:200},{date:'2026-01-03',value:220}],events:[{date:'2026-01-02',type:'deposit',amount:null}]})
    expect(result.series.map(point=>point.value)).toEqual([0,null,null]);expect(result.change).toBeNull()
  })
  it('does not substitute zero for unavailable account funding',()=>{
    expect(fundingAdjustedHistory({series:[{date:'2026-01-01',value:100},{date:'2026-01-02',value:200}],events:[],coverage:{unavailableAccounts:['Example']}}).change).toBeNull()
  })
})
