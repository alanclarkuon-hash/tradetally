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
    expect(view.findAll('[data-card]').map(card=>card.attributes('data-card'))).toEqual(['total','history','allocation','heatmap','brokerSyncs'])
    view.unmount()
    const next=create();await flushPromises()
    expect(next.findAll('[data-card]')[1].attributes('data-card')).toBe('history')
    next.vm.reset();await flushPromises()
    expect(next.findAll('[data-card]')[1].attributes('data-card')).toBe('allocation');next.unmount()
  })
  it('merges legacy summary cards at the first saved position and keeps visible balances accessible',async()=>{
    localStorage.setItem('portfolioDashboardLayout',JSON.stringify([{id:'history'},{id:'cash',visible:true},{id:'total',visible:false},{id:'holdings',visible:false}]))
    const view=create();await flushPromises()
    expect(view.findAll('[data-card]').map(card=>card.attributes('data-card'))).toEqual(['history','total','allocation','heatmap','brokerSyncs'])
    expect(view.text()).toContain('Total balance')
    expect(view.find('[data-card="total"]').classes()).toContain('wide-card');view.unmount()
  })
  it('keeps the combined card hidden when all legacy balance cards were hidden',async()=>{
    localStorage.setItem('portfolioDashboardLayout',JSON.stringify(['total','holdings','cash'].map(id=>({id,visible:false}))))
    const view=create();await flushPromises()
    expect(view.text()).not.toContain('Total balance');view.unmount()
  })
  it('ignores obsolete and duplicate saved cards and appends missing cards',async()=>{
    localStorage.setItem('portfolioDashboardLayout',JSON.stringify([{id:'history',visible:false},{id:'history'},{id:'obsolete'}]))
    const view=create();await flushPromises()
    expect(view.findAll('[data-card]')).toHaveLength(5)
    expect(view.findAll('[data-card]')[0].attributes('data-card')).toBe('history')
    expect(view.text()).not.toContain('History chart');view.unmount()
  })
})


it('renders sync status without invoking financial slots while balances are unavailable',async()=>{
 const view=mount(PortfolioCardLayout,{props:{dataAvailable:false},slots:{total:()=>{throw Error('Financial data unavailable')},brokerSyncs:'<p>All connections status</p>'}});await flushPromises();
 expect(view.text()).toContain('All connections status');
 expect(view.find('[data-card="total"]').classes()).toContain('hidden-card');
 view.unmount();
});
