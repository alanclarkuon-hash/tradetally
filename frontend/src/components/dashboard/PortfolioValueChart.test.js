import {describe,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
const captured=vi.hoisted(()=>[])
vi.mock('@/lib/chartSetup',()=>({Chart:class {constructor(canvas,config){captured.push(config)}destroy(){}}}))
import PortfolioValueChart from './PortfolioValueChart.vue'

describe('portfolio value chart',()=>{
  it('places today and past funding on real dates without waiting for background-tab animations',async()=>{
    const history={change:null,series:[{date:'2026-10-03',value:120,holdings:80,cash:30,stablecoins:10}],
      events:[{date:'2024-03-27',type:'deposit',amount:50,nativeAmount:50,nativeCurrency:'GBP',account:'Example'}],
      coverage:{recordedDays:1,firstValueDate:'2026-10-03',partialDays:0,missingEventFx:0}}
    const wrapper=mount(PortfolioValueChart,{props:{history,currency:'GBP'}})
    await flushPromises()
    const config=captured.at(-1)
    expect(config.options.animation).toBe(false)
    expect(config.data.datasets[0].data[0]).toMatchObject({x:Date.parse('2026-10-03T12:00:00Z'),y:120})
    expect(config.data.datasets[1].data[0].x).toBe(Date.parse('2024-03-27T12:00:00Z'))
    expect(config.options.scales.value.axis).toBe('y')
    expect(wrapper.text()).toContain('Earlier funding activity is shown along the bottom')
    expect(wrapper.find('canvas').attributes('aria-label')).toContain('Details are available below')
    await wrapper.setProps({currency:'USD'});await flushPromises()
    expect(captured.at(-1).options.scales.value.ticks.callback(120)).toContain('$')
    wrapper.unmount()
  })
})
