import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortfolioDashboardView from './PortfolioDashboardView.vue'

vi.mock('@/stores/uiPreferences',()=>({useUiPreferencesStore:()=>({init:async()=>{},notifyChanged:vi.fn()})}))

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), setAccounts: vi.fn(), selection: null, change: 25, fail: false }))
vi.mock('@/services/api', () => ({ default: mock }))
vi.mock('@/composables/useGlobalAccountFilter', async () => {
  const { ref } = await import('vue')
  mock.selection=ref(null)
  mock.setAccounts.mockImplementation(values=>mock.selection.value=values===null?null:values.slice().sort().join(',')||'__none__')
  return { useGlobalAccountFilter: () => ({ accounts: ref([{value:"one",label:"First account"},{value:"two",label:"Second account"}]), selectedAccount: mock.selection, setAccounts: mock.setAccounts, fetchAccounts: vi.fn() }) }
})

const dashboard = { accountCount: 1, asOf: '2026-10-04T12:00:00Z', holdings: [],
  totals: { portfolioValue: 100, holdingsValue: 60, cashValue: 40, stablecoinValue: 0, pnl: 0, pnlPercent: 0 },
  coverage: { missingCash: 0, missingPrices: 0, missingPnl: 0, unclassified: 0 } }
const create = () => mount(PortfolioDashboardView, { global: { stubs: { RouterLink: true, PortfolioValueChart: true } } })

beforeEach(() => {
  localStorage.removeItem('portfolioDashboardLayout')
  vi.clearAllMocks()
  mock.selection.value=null
  mock.change = 25
  mock.fail = false
  mock.post.mockResolvedValue({ data: {} })
  mock.get.mockImplementation(async url => {
    if (url.endsWith('/dashboard')) return { data: dashboard }
    if (mock.fail) throw Error('History unavailable')
    return { data: { change: mock.change } }
  })
})

describe('Portfolio summary cards', () => {
  it('uses end-date holdings for the heatmap while keeping summary cards current',async()=>{
    mock.get.mockImplementation(async url=>({data:url.endsWith('/dashboard')?{...dashboard,
      holdings:[{symbol:'CURRENT',value:50,assetClass:'Stocks',sector:'Technology',industry:'Software'}],
      heatmapDate:'2024-02-01',heatmapHoldings:[{symbol:'PAST',value:80,pnlPercent:20,assetClass:'Stocks',sector:'Technology',industry:'Software'}],heatmapCoverage:{missingPnl:0,unclassified:0,warnings:[]}}:{change:25}}));
    const view=create();await flushPromises();
    expect(view.findAll('.holding-tile').map(tile=>tile.attributes('aria-label')).join()).toContain('PAST');
    expect(view.findAll('.holding-tile').map(tile=>tile.attributes('aria-label')).join()).not.toContain('CURRENT');
    expect(view.text()).toContain('Holdings owned on 01/02/2024');
    expect(view.findAll('article')[0].text()).toContain('£100.00');
    view.unmount();
  })
  it('shows balances only and supplies history to the chart card', async () => {
    const view = create()
    await flushPromises()
    expect(view.findAll('article')[0].text()).toContain('£100.00')
    expect(view.findAll('article')[1].text()).toContain('£60.00')
    expect(view.findAll('article')[0].text()).not.toContain('change')
    expect(view.findAll('article')[1].text()).not.toContain('since acquisition')
    expect(view.findComponent({ name: 'PortfolioValueChart' }).props('history')).toEqual({change:25})
    view.unmount()
  })

  it('uses the selected currency and date range for the same change shown by the chart', async () => {
    const view = create()
    await flushPromises()
    await view.find('[data-period="30d"]').trigger('click')
    await flushPromises()
    await view.find('#portfolio-currency').setValue('USD')
    await flushPromises()
    expect(view.find('article').text()).toContain('US$100.00')
    const params = mock.get.mock.calls.filter(([url]) => url.endsWith('/value-history')).at(-1)[1].params
    expect(params.currency).toBe('USD')
    expect(params.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const elapsed = (new Date(params.end_date)-new Date(params.start_date))/86400000
    expect(elapsed).toBe(30)
    expect(view.find('.period-picker summary').attributes('title')).toBe('Last 30 Days')
    expect(view.find('.date-filter-dot').exists()).toBe(true)
    expect(params.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    view.unmount()
  })

  it('does not display an old change when refreshed history fails', async () => {
    const view = create()
    await flushPromises()
    mock.fail = true
    await view.find('.refresh').trigger('click')
    await flushPromises()
    expect(view.findComponent({ name: 'PortfolioValueChart' }).props('error')).toContain('unavailable')
    expect(view.find('article').text()).not.toContain('+£25.00')
    view.unmount()
  })
})

describe('Portfolio filter interactions', () => {
  it('shares changes in both directions, including empty and All Accounts',async()=>{
    const view=create();await flushPromises()
    const boxes=view.findAll('.account-menu input')
    await boxes[0].setValue(false);await flushPromises()
    expect(mock.setAccounts).toHaveBeenLastCalledWith(['two'])
    expect(mock.selection.value).toBe('two')
    mock.selection.value='one,__unsorted__';await flushPromises()
    expect(boxes[0].element.checked).toBe(true)
    expect(boxes[1].element.checked).toBe(false)
    await boxes[0].setValue(false);await flushPromises()
    expect(mock.selection.value).toBe('__none__')
    await view.find('.account-menu button').trigger('click');await flushPromises()
    expect(mock.selection.value).toBe(null)
    expect(boxes.every(box=>box.element.checked)).toBe(true)
    view.unmount()
  })
  it('ignores a previous pending response after the last account is deselected',async()=>{
    const view=create();await flushPromises()
    const boxes=view.findAll('.account-menu input')
    let resolve
    mock.get.mockImplementation(()=>new Promise(done=>{resolve=done}))
    await boxes[0].setValue(false)
    await boxes[1].setValue(false)
    resolve({data:dashboard});await flushPromises()
    expect(view.text()).toContain('No accounts selected')
    expect(view.findAll('article')).toHaveLength(0)
    expect(boxes.every(box=>!box.element.checked)).toBe(true)
    view.unmount()
  })
  it('keeps an empty selection empty without loading all accounts, and resumes for one chosen account',async()=>{
    const view=create()
    await flushPromises()
    const boxes=view.findAll('.account-menu input')
    await boxes[0].setValue(false);await flushPromises()
    vi.clearAllMocks()
    await boxes[1].setValue(false);await flushPromises()
    expect(boxes.every(box=>!box.element.checked)).toBe(true)
    expect(view.find('.account-picker summary').attributes('title')).toBe('No accounts selected')
    expect(view.text()).toContain('Select an account using the accounts filter')
    expect(view.findAll('article')).toHaveLength(0)
    expect(view.findComponent({name:'PortfolioValueChart'}).exists()).toBe(false)
    expect(mock.get).not.toHaveBeenCalled()
    expect(mock.post).not.toHaveBeenCalled()
    await view.find('.refresh').trigger('click');await flushPromises()
    await view.find('#portfolio-currency').setValue('USD');await flushPromises()
    expect(mock.get).not.toHaveBeenCalled()
    await boxes[0].setValue(true);await flushPromises()
    expect(boxes[0].element.checked).toBe(true)
    expect(boxes[1].element.checked).toBe(false)
    expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/dashboard')).at(-1)[1].params.accounts).toBe('one')
    await view.find('.account-menu button').trigger('click');await flushPromises()
    expect(boxes.every(box=>box.element.checked)).toBe(true)
    view.unmount()
  })
  it('checks all accounts and allows narrowing the selection', async () => {
    const view=create()
    await flushPromises()
    const boxes=view.findAll('.account-menu input')
    expect(boxes.every(box=>box.element.checked)).toBe(true)
    await boxes[0].setValue(false)
    await flushPromises()
    expect(boxes[0].element.checked).toBe(false)
    expect(boxes[1].element.checked).toBe(true)
    expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/dashboard')).at(-1)[1].params.accounts).toBe('two')
    await view.find('.account-menu button').trigger('click')
    await flushPromises()
    expect(boxes.every(box=>box.element.checked)).toBe(true)
    view.unmount()
  })
  it('closes both menus outside and keeps inside clicks open', async () => {
    const view=create()
    await flushPromises()
    const account=view.find('.account-picker').element,date=view.find('.period-picker').element
    account.open=true
    date.open=true
    document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}))
    expect(account.open).toBe(false)
    expect(date.open).toBe(false)
    account.open=true
    await view.find('.account-menu').trigger('pointerdown')
    expect(account.open).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))
    expect(account.open).toBe(false)
    view.unmount()
  })
})
