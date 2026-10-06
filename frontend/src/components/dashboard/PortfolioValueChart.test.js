import {describe,it,expect,vi,beforeEach} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
beforeEach(()=>setActivePinia(createPinia()))
import {mount,flushPromises} from '@vue/test-utils'
const captured=vi.hoisted(()=>[])
vi.mock('@/lib/chartSetup',()=>({Chart:class {constructor(canvas,config){captured.push(config)}destroy(){}}}))
import PortfolioValueChart from './PortfolioValueChart.vue'

describe('portfolio value chart',()=>{
  it('plots only the combined line even when older responses contain individual account histories',async()=>{
    const point={date:'2026-01-01',value:100,holdings:60,cash:40,stablecoins:0,reconstructedAccounts:1}
    const history={series:[{date:'2025-12-31',value:null},point],events:[],accountSeries:[{name:'First',series:[point]},{name:'Second',series:[]}],coverage:{recordedDays:1,partialDays:1,missingEventFx:0,accounts:[]}}
    const wrapper=mount(PortfolioValueChart,{props:{history}});await flushPromises()
    const config=captured.at(-1)
    expect(config.data.datasets[0].data[0].y).toBeNull()
    expect(config.data.datasets.filter(d=>d.type!=='scatter')).toHaveLength(1)
    expect(config.data.datasets[0]).toMatchObject({label:'Portfolio value',spanGaps:false})
    expect(config.options.scales.value.display).toBe(true)
    expect(wrapper.findAll('details')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Show individual account histories')
    wrapper.unmount()
  })
  it('explains missing combined values instead of drawing a blank graph',async()=>{
    const history={series:[{date:'2026-10-05',value:null,missingAccounts:1}],events:[],change:null,
      captureWarnings:['Example broker: dated snapshot unavailable.'],coverage:{recordedDays:0,accounts:[{name:'Example account',days:0}]}}
    const view=mount(PortfolioValueChart,{props:{history}});await flushPromises()
    expect(view.find('canvas').exists()).toBe(false)
    expect(view.text()).toContain('No complete combined portfolio values')
    expect(view.text()).toContain('Example account')
    expect(view.text()).toContain('dated snapshot unavailable')
    await view.setProps({history:{...history,series:[{date:'2026-10-05',value:100}],coverage:{recordedDays:1,accounts:[]}}});await flushPromises()
    expect(view.find('canvas').exists()).toBe(true)
    expect(view.text()).toContain('A second is needed')
    view.unmount()
  })
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
    expect(wrapper.find('canvas').attributes('aria-label')).not.toContain('Details are available below')
    await wrapper.setProps({history:{...history,series:[{...history.series[0],estimatedAccounts:1}],coverage:{...history.coverage,estimatedDays:1}}});await flushPromises()
    expect(captured.at(-1).options.plugins.tooltip.callbacks.label({raw:captured.at(-1).data.datasets[0].data[0],dataset:{}})).toContain('Estimate: missing historical prices valued at zero')
    await wrapper.setProps({currency:'USD'});await flushPromises()
    expect(captured.at(-1).options.scales.value.ticks.callback(120)).toContain('$')
    await wrapper.setProps({history:{...history,range:{start_date:'2026-09-26',end_date:'2026-10-03'}}});await flushPromises()
    expect(captured.at(-1).options.scales.x.min).toBe(Date.parse('2026-09-26T00:00:00Z'))
    expect(captured.at(-1).options.scales.x.max).toBe(Date.parse('2026-10-03T23:59:59.999Z'))
    wrapper.unmount()
  })
})

const history = { change: 200, series: [{date:'2026-01-01',value:100},{date:'2026-01-02',value:300}], events: [{date:'2026-01-02',type:'deposit',amount:150}], coverage: { recordedDays: 2, cryptoTransfersIncluded:false } }

describe('Portfolio change selector', () => {
  it('removes crypto principal from gains and formats missing coin valuations without treating tickers as fiat',async()=>{
    const crypto={date:'2026-01-02',type:'transfer',crypto:true,quantity:10,asset:'SUI',amount:150,account:'Example'}
    const view=mount(PortfolioValueChart,{props:{history:{...history,events:[crypto],coverage:{recordedDays:2,cryptoTransfersIncluded:true}}}})
    await view.find('input[type=checkbox]').setValue(false);await flushPromises()
    expect(captured.at(-1).data.datasets[0].data.map(p=>p.y)).toEqual([0,50])
    expect(view.text()).not.toContain('Crypto transfers are not removed')
    await view.setProps({history:{...history,events:[{...crypto,amount:null}],coverage:{recordedDays:2,cryptoTransfersIncluded:true,missingCryptoTransferPrices:1}}});await flushPromises()
    expect(captured.at(-1).options.plugins.tooltip.callbacks.label({raw:{...crypto,amount:null}})).toContain('10 SUI')
    expect(captured.at(-1).data.datasets[0].data.at(-1).y).toBeNull()
    view.unmount()
  })
  it('switches both the line and large amount to overall gains and back',async()=>{
    const view=mount(PortfolioValueChart,{props:{history}});await flushPromises()
    expect(view.find('.history-change').text()).toContain('+£200.00')
    await view.find('input[type=checkbox]').setValue(false);await flushPromises()
    expect(view.find('.history-change').text()).toContain('+£50.00')
    expect(view.text()).toContain('Includes realised gains, income and fees')
    expect(captured.at(-1).data.datasets[0].label).toBe('Overall gains')
    expect(captured.at(-1).data.datasets[0].data.map(point=>point.y)).toEqual([0,50])
    expect(view.find('canvas').attributes('aria-label')).toContain('Overall portfolio gains')
    await view.setProps({currency:'USD'});await flushPromises()
    expect(view.find('.history-change').text()).toContain('+US$50.00')
    await view.find('input[type=checkbox]').setValue(true);await flushPromises()
    expect(captured.at(-1).data.datasets[0].data.map(point=>point.y)).toEqual([100,300])
    expect(view.find('.history-change').text()).toContain('+US$200.00');view.unmount()
  })
  it('shows unavailable when funding FX is missing rather than overstating gains',async()=>{
    const view=mount(PortfolioValueChart,{props:{history:{...history,events:[{date:'2026-01-02',type:'deposit',amount:null,nativeAmount:100,nativeCurrency:'USD'}]}}})
    await view.find('input[type=checkbox]').setValue(false);await flushPromises()
    expect(view.find('.history-change').text()).toContain('Change unavailable')
    expect(captured.at(-1).data.datasets[0].data.at(-1).y).toBeNull();view.unmount()
  })
  it('hides stale amounts while refreshing or when history fails', async () => {
    const view = mount(PortfolioValueChart, { props: { history, loading: true } })
    expect(view.find('.history-change').text()).toContain('Loading change…')
    await view.setProps({ loading: false, error: 'History failed' })
    expect(view.find('.history-change').text()).toContain('Change unavailable')
    expect(view.find('.history-change').text()).not.toContain('£200');view.unmount()
  })
})
