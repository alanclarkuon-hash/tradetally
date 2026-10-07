import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortfolioDashboardView from './PortfolioDashboardView.vue'
import { createPinia, setActivePinia } from 'pinia'
import { useDashboardDateFilterStore } from '@/stores/dashboardDateFilter'

vi.mock('@/stores/uiPreferences',()=>({useUiPreferencesStore:()=>({init:async()=>{},notifyChanged:vi.fn()})}))

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), setAccounts: vi.fn(), selection: null, accounts: null, change: 25, fail: false }))
vi.mock('@/services/api', () => ({ default: mock }))
vi.mock('@/composables/useGlobalAccountFilter', async () => {
  const { ref } = await import('vue')
  mock.selection=ref(null)
  mock.accounts=ref([])
  mock.setAccounts.mockImplementation(values=>mock.selection.value=values===null?null:values.slice().sort().join(',')||'__none__')
  return { useGlobalAccountFilter: () => ({ accounts: mock.accounts, selectedAccount: mock.selection, setAccounts: mock.setAccounts, fetchAccounts: vi.fn() }) }
})

const dashboard = { accountCount: 1, asOf: '2026-10-04T12:00:00Z', holdings: [],
  totals: { portfolioValue: 100, holdingsValue: 60, cashValue: 40, stablecoinValue: 0, pnl: 0, pnlPercent: 0 },
  coverage: { missingCash: 0, missingPrices: 0, missingPnl: 0, unclassified: 0 } }
const create = () => mount(PortfolioDashboardView, { global: { stubs: { RouterLink: true, PortfolioValueChart: true, StockLogo: true } } })

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.removeItem('dashboardTimeRange')
  localStorage.removeItem('dashboardCustomStartDate')
  localStorage.removeItem('dashboardCustomEndDate')
  localStorage.removeItem('portfolioDashboardLayout')
  vi.clearAllMocks()
  mock.selection.value=null
  mock.accounts.value=[{value:'one',label:'First account'},{value:'two',label:'Second account'}]
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
  it('uses crypto identities for heatmap logos and omits logos from tiny holdings',async()=>{
    mock.get.mockImplementation(async url=>({data:url.endsWith('/dashboard')?{...dashboard,holdings:[
      {symbol:'SUI',value:80,assetClass:'Crypto assets',category:'Layer 1'},
      {symbol:'MSFT',value:80,assetClass:'Stocks',sector:'Technology',industry:'Software'},
      {symbol:'TINY',value:.001,assetClass:'Stocks',sector:'Technology',industry:'Software'}
    ]}:{change:25}}));
    const view=create();await flushPromises();
    const logos=view.findAllComponents({name:'StockLogo'});
    expect(logos.map(logo=>[logo.props('symbol'),logo.props('instrumentType')])).toEqual(expect.arrayContaining([['SUI','crypto'],['MSFT','stock']]));
    expect(logos.some(logo=>logo.props('symbol')==='TINY')).toBe(false);
    view.unmount();
  })
  it('loads automatically when a shared account fetch finishes after mounting',async()=>{
    mock.accounts.value=[]
    const view=create();await flushPromises()
    expect(mock.get).not.toHaveBeenCalled()
    mock.accounts.value=[{value:'one',label:'First account'}]
    await flushPromises()
    expect(view.find('article').text()).toContain('£100.00')
    expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/dashboard'))).toHaveLength(1)
    view.unmount()
  })
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
    expect(view.findComponent({ name: 'PortfolioValueChart' }).props('history')).toEqual({change:25,captureWarnings:[]})
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
  it('uses shared custom dates for summary/heatmap and chart requests, then updates the shared preset',async()=>{
    const dates=useDashboardDateFilterStore()
    dates.selection={timeRange:'custom',startDate:'2024-05-10',endDate:'2024-06-01'}
    const view=create();await flushPromises()
    for(const [url,config] of mock.get.mock.calls.filter(([url])=>url.includes('/portfolio/'))) {
      expect(config.params.start_date).toBe('2024-05-10')
      expect(config.params.end_date).toBe('2024-06-01')
    }
    await view.find('[data-period="this_week"]').trigger('click');await flushPromises()
    expect(dates.selection.timeRange).toBe('this_week')
    expect(view.find('.period-picker summary').attributes('title')).toBe('This Week')
    dates.selection={timeRange:'custom',startDate:'2023-01-01',endDate:'2023-02-01'};await flushPromises()
    expect(view.find('.custom-dates input').element.value).toBe('2023-01-01')
    view.unmount()
  })
  it('uses only the shared filter and reacts to named, Unsorted, empty and All selections',async()=>{
    const view=create();await flushPromises()
    expect(view.find('.account-picker').exists()).toBe(false)
    mock.selection.value='one,__unsorted__';await flushPromises()
    expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/dashboard')).at(-1)[1].params.accounts).toBe('one')
    mock.selection.value='__none__';await flushPromises()
    expect(view.text()).toContain('No accounts selected')
    expect(view.findAll('article')).toHaveLength(0)
    mock.selection.value=null;await flushPromises()
    expect(view.find('article').text()).toContain('£100.00')
    expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/dashboard')).at(-1)[1].params.accounts).toBe('')
    expect(mock.setAccounts).not.toHaveBeenCalled()
    view.unmount()
  })
  it('ignores a pending response after the shared selection becomes empty',async()=>{
    const view=create();await flushPromises()
    let resolve
    mock.get.mockImplementation(()=>new Promise(done=>{resolve=done}))
    mock.selection.value='two';await flushPromises()
    mock.selection.value='__none__';await flushPromises()
    resolve({data:dashboard});await flushPromises()
    expect(view.text()).toContain('No accounts selected')
    expect(view.findAll('article')).toHaveLength(0)
    view.unmount()
  })
  it('keeps empty selection empty on refresh and currency changes',async()=>{
    mock.selection.value='__none__'
    const view=create();await flushPromises()
    expect(mock.get).not.toHaveBeenCalled()
    expect(mock.post).not.toHaveBeenCalled()
    await view.find('.refresh').trigger('click');await flushPromises()
    await view.find('#portfolio-currency').setValue('USD');await flushPromises()
    expect(mock.get).not.toHaveBeenCalled()
    mock.selection.value='one';await flushPromises()
    expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/dashboard')).at(-1)[1].params.accounts).toBe('one')
    view.unmount()
  })
  it('closes the date menu outside and with Escape, keeping inside clicks open',async()=>{
    const view=create();await flushPromises()
    const date=view.find('.period-picker').element
    date.open=true
    await view.find('.period-menu').trigger('pointerdown')
    expect(date.open).toBe(true)
    document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}))
    expect(date.open).toBe(false)
    date.open=true
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))
    expect(date.open).toBe(false)
    view.unmount()
  })
})


describe('Delayed heatmap quotes',()=>{
  it('marks quotes older than fifteen minutes, including tiny tiles, but not fresh or unknown dates',async()=>{
    const now=Date.now();
    const assets=[{symbol:'OLD',value:99,priceAsOf:new Date(now-960000).toISOString()},
      {symbol:'TINY',value:0.01,priceAsOf:new Date(now-960000).toISOString()},
      {symbol:'FRESH',value:80,priceAsOf:new Date(now-600000).toISOString()},
      {symbol:'UNKNOWN',value:50,priceAsOf:null}].map(p=>({...p,assetClass:'Stocks',sector:'Technology',industry:'Software',pnlPercent:1}));
    mock.get.mockImplementation(async url=>({data:url.endsWith('/dashboard')?{...dashboard,holdings:assets}:{change:25}}));
    const view=create();await flushPromises();
    const tiles=view.findAll('.holding-tile');
    for(const symbol of ['OLD','TINY']){
      const tile=tiles.find(t=>t.attributes('aria-label').startsWith(symbol+','));
      expect(tile.find('sup.quote-delay-marker').text()).toBe('d');
      expect(tile.attributes('aria-label')).toContain('quote more than 15 minutes old');
    }
    for(const symbol of ['FRESH','UNKNOWN'])expect(tiles.find(t=>t.attributes('aria-label').startsWith(symbol+',')).find('sup').exists()).toBe(false);
    view.unmount();
  });
  it('updates age while the page stays open and clears its timer when unmounted',async()=>{
    vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});
    const now=Date.now();
    mock.get.mockImplementation(async url=>({data:url.endsWith('/dashboard')?{...dashboard,holdings:[{symbol:'BOUNDARY',value:50,assetClass:'Stocks',sector:'Technology',industry:'Software',priceAsOf:new Date(now-900000).toISOString()}]}:{change:25}}));
    const view=create();
    try{
      await flushPromises();expect(view.find('.quote-delay-marker').exists()).toBe(false);
      vi.advanceTimersByTime(30000);await flushPromises();expect(view.find('.quote-delay-marker').text()).toBe('d');
      view.unmount();expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers()}
  });
});
