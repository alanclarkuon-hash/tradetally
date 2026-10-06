import { mount,flushPromises } from '@vue/test-utils'
import { beforeEach,describe,expect,it,vi } from 'vitest'
import PortfolioCardLayout from './PortfolioCardLayout.vue'
const preferences=vi.hoisted(()=>({init:vi.fn(async()=>{}),notifyChanged:vi.fn()}))
vi.mock('@/stores/uiPreferences',()=>({useUiPreferencesStore:()=>preferences}))
const create=()=>mount(PortfolioCardLayout,{props:{customizing:true},slots:{total:'<p>Total balance</p>',history:'<p>History chart</p>'}})
beforeEach(()=>{localStorage.clear();vi.clearAllMocks()})
describe('Portfolio card customization',()=>{
  it('hides cards, saves the choice and restores it on the next visit',async()=>{
    const view=create();await flushPromises()
    await view.find('[aria-label="Hide Combined portfolio value"]').trigger('click')
    expect(view.text()).not.toContain('Total balance')
    expect(preferences.notifyChanged).toHaveBeenLastCalledWith('portfolioDashboardLayout',expect.arrayContaining([{id:'total',visible:false}]))
    view.unmount()
    const next=create();await flushPromises()
    expect(next.text()).not.toContain('Total balance')
    await next.find('[aria-label="Show Combined portfolio value"]').trigger('click')
    expect(next.text()).toContain('Total balance');next.unmount()
  })
  it('reorders cards, restores the order and resets to defaults',async()=>{
    const view=create();await flushPromises()
    await view.find('[aria-label="Move Portfolio Value up"]').trigger('click')
    expect(view.findAll('[data-card]').map(card=>card.attributes('data-card'))).toEqual(['total','holdings','cash','history','allocation','heatmap','brokerSyncs'])
    view.unmount()
    const next=create();await flushPromises()
    expect(next.findAll('[data-card]')[3].attributes('data-card')).toBe('history')
    next.vm.reset();await flushPromises()
    expect(next.findAll('[data-card]')[3].attributes('data-card')).toBe('allocation');next.unmount()
  })
  it('ignores obsolete and duplicate saved cards and appends missing cards',async()=>{
    localStorage.setItem('portfolioDashboardLayout',JSON.stringify([{id:'history',visible:false},{id:'history'},{id:'obsolete'}]))
    const view=create();await flushPromises()
    expect(view.findAll('[data-card]')).toHaveLength(7)
    expect(view.findAll('[data-card]')[0].attributes('data-card')).toBe('history')
    expect(view.text()).not.toContain('History chart');view.unmount()
  })
})
