import {useAuthStore} from '@/stores/auth'
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
const create = () => mount(PortfolioDashboardView, { global: { stubs: { RouterLink: true, PortfolioValueChart: true, BrokerSyncStatusCard: true, StockLogo: true, HistoryBackfillStatus: true } } })

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAuthStore().user={settings:{display_currency:'GBP'}}
  localStorage.removeItem('dashboardTimeRange')
  localStorage.removeItem('dashboardCustomStartDate')
  localStorage.removeItem('dashboardCustomEndDate')
  localStorage.removeItem('portfolioDashboardLayout')
  vi.clearAllMocks()
  mock.selection.value=null
  mock.accounts.value=[{value:'one',label:'First account',currency:'GBP'},{value:'two',label:'Second account',currency:'USD'}]
  mock.change = 25
  mock.fail = false
  mock.post.mockResolvedValue({ data: {} })
  mock.get.mockImplementation(async url => {
    if (url.endsWith('/display-fx')) return {data:{rates:{USD:1,GBP:.8,EUR:.9}}}
    if (url.endsWith('/dashboard')) return { data: dashboard }
    if (mock.fail) throw Error('History unavailable')
    return { data: { change: mock.change } }
  })
})

describe('Portfolio summary cards', () => {
  it('keeps total, holdings and cash breakdown in one card with a shared currency control',async()=>{
    mock.get.mockImplementation(async url=>({data:url.endsWith('/dashboard')?{...dashboard,currency:'GBP',totals:{...dashboard.totals,cashValue:30,stablecoinValue:10}}:url.endsWith('/display-fx')?{rates:{USD:1,GBP:.8,EUR:.9}}:{change:25}}))
    const view=create();await flushPromises()
    const card=view.find('[data-card="total"]')
    expect(card.text()).toContain('Combined portfolio value')
    expect(card.text()).toContain('£100.00')
    expect(card.text()).toContain('Holdings value£60.00')
    expect(card.text()).toContain('Cash & stablecoins£40.00')
    expect(card.text()).toContain('Cash £30.00 · Stablecoins £10.00')
    expect(card.findAll('button.currency-toggle')).toHaveLength(1)
    expect(view.find('[data-card="holdings"]').exists()).toBe(false)
    expect(view.find('[data-card="cash"]').exists()).toBe(false)
    await card.find('button.currency-toggle').trigger('click');await flushPromises()
    expect(card.text()).toContain('$125.00')
    expect(card.text()).toContain('Holdings value$75.00')
    expect(card.text()).toContain('Cash & stablecoins$50.00')
    view.unmount()
  })
  it('refreshes background metadata without recapturing history and stops after completion',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval']})
    let calls=0
    mock.get.mockImplementation(async url=>({data:url.endsWith('/dashboard')?{...dashboard,metadataUpdating:++calls===1}:{change:25}}))
    const view=create();await flushPromises()
    expect(calls).toBe(1)
    const captures=mock.post.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000);await flushPromises()
    expect(calls).toBe(2);expect(mock.post.mock.calls.length).toBe(captures)
    await vi.advanceTimersByTimeAsync(10000);expect(calls).toBe(2)
    view.unmount();vi.useRealTimers()
  })

  it('automatically refreshes quotes and monitoring status without recapturing history',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval']})
    const old=new Date(Date.now()-3600000).toISOString()
    const row={symbol:'AAA',instrumentType:'stock',quantity:2,value:80,cost:60,pnlBasis:60,pnl:20,pnlPercent:33,priceAsOf:old,assetClass:'Stocks',industry:'Software'}
    mock.get.mockImplementation(async url=>{
      if(url.endsWith('/dashboard'))return {data:{...dashboard,currency:'GBP',holdings:[row]}}
      if(url.endsWith('/quotes'))return {data:{currency:'GBP',usdRate:1,quotes:[{symbol:'AAA',current_price:50,last_updated:new Date().toISOString(),data_source:'broker:etoro:stock'}],monitoring:{running:true,currentRotation:{processed:25,total:90,elapsedSeconds:45},lastRotation:{durationSeconds:180,total:90}}}}
      return {data:{rates:{GBP:1},change:25}}
    })
    const view=create();await flushPromises();await view.find('.holding-tile').trigger('click')
    const captures=mock.post.mock.calls.length
    await vi.advanceTimersByTimeAsync(30000);await flushPromises()
    expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/quotes'))).toHaveLength(1)
    expect(mock.post.mock.calls.length).toBe(captures)
    expect(view.find('.holding-detail').text()).toContain('\u00a3100.00');expect(view.find('.holding-detail').text()).toContain('Source eToro')
    expect(view.find('[data-testid="quote-monitor-status"]').text()).toContain('Last full cycle: 3m 0s for 90 assets')
    view.unmount();await vi.advanceTimersByTimeAsync(60000);expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/quotes'))).toHaveLength(1);vi.useRealTimers()
  })
  it('does not overlap automatic quote requests and ignores replies after filters change',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval']})
    let finish,signal
    mock.get.mockImplementation(async(url,options)=>{
      if(url.endsWith('/quotes')){signal=options.signal;return new Promise(resolve=>finish=resolve)}
      return {data:url.endsWith('/dashboard')?{...dashboard,currency:'GBP'}:{change:25}}
    })
    const view=create();await flushPromises();await vi.advanceTimersByTimeAsync(60000)
    expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/quotes'))).toHaveLength(1)
    mock.selection.value='one';await flushPromises();expect(signal.aborted).toBe(true)
    finish({data:{currency:'GBP',usdRate:1,quotes:[],monitoring:{running:false}}});await flushPromises()
    expect(view.find('[data-testid="quote-monitor-status"]').text()).not.toContain('Monitor stopped')
    view.unmount();vi.useRealTimers()
  })
  it('pauses automatic quote reads when the tab is hidden',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval']})
    const hidden=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden')
    const view=create();await flushPromises();await vi.advanceTimersByTimeAsync(60000)
    expect(mock.get.mock.calls.some(([url])=>url.endsWith('/quotes'))).toBe(false)
    view.unmount();hidden.mockRestore();vi.useRealTimers()
  })


  it('labels current broker position values separately and updates them without a sync',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval']})
    const row={symbol:'CFD',instrumentType:'cfd',valuationKind:'broker_position',valuationStatus:'waiting',accounts:['one'],quantity:2,cost:100,value:100,pnlBasis:100,pnl:0,pnlPercent:0,priceAsOf:new Date(Date.now()-3600000).toISOString(),assetClass:'Funds & ETFs',industry:'Funds & ETFs'}
    mock.get.mockImplementation(async(url,options)=>{
      if(url.endsWith('/dashboard'))return {data:{...dashboard,currency:'GBP',holdings:[row]}}
      if(url.endsWith('/quotes'))return {data:{currency:'GBP',usdRate:1,quotes:[],monitoring:{running:true},valuations:{positions:[{symbol:'CFD',instrumentType:'cfd',accounts:['one'],quantity:2,capital:100,value:110,asOf:new Date().toISOString(),source:'broker:etoro:position',timestampKind:'valuation',status:'ready'}]}}}
      return {data:{rates:{GBP:1},change:25}}
    })
    mock.selection.value='one'
    const view=create();await flushPromises();await view.find('.holding-tile').trigger('click')
    expect(view.find('.saved-quote').text()).toContain('Broker position valuation')
    const captures=mock.post.mock.calls.length
    await vi.advanceTimersByTimeAsync(30000);await flushPromises()
    expect(view.find('.holding-detail').text()).toContain('110.00');expect(view.find('.saved-quote').text()).toContain('Source eToro')
    expect(mock.post.mock.calls.length).toBe(captures)
    expect(mock.get.mock.calls.find(([url])=>url.endsWith('/quotes'))[1].params.accounts).toBe('one')
    view.unmount();vi.useRealTimers()
  })
  it('shows the selected price timestamp and source beneath the heatmap',async()=>{
    useAuthStore().user.timezone='Europe/London'
    mock.get.mockImplementation(async url=>({data:url.endsWith('/dashboard')?{...dashboard,holdings:[
      {symbol:'AAA',value:80,pnlPercent:1,assetClass:'Stocks',sector:'Technology',industry:'Software',priceAsOf:'2026-10-12T12:34:56Z',quoteSource:'yahoo',quoteTimestampKind:'trade'},
      {symbol:'BBB',value:70,pnlPercent:0,assetClass:'Stocks',sector:'Technology',industry:'Software',priceAsOf:null,quoteSource:null}
    ]}:{change:25}}))
    const view=create();await flushPromises()
    await view.findAll('.holding-tile')[0].trigger('click')
    expect(view.find('.saved-quote').text()).toContain('12/10/2026, 13:34:56 BST')
    expect(view.find('.saved-quote').text()).toContain('Source Yahoo Finance')
    await view.findAll('.holding-tile')[1].trigger('click')
    expect(view.find('.saved-quote').text()).toBe('Saved market quote Unavailable · Source Unavailable')
    view.unmount()
  })


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
    expect(view.find('[aria-label="Portfolio value summary"]').text()).toContain('£60.00')
    expect(view.findAll('article')[0].text()).not.toContain('change')
    expect(view.find('[aria-label="Portfolio value summary"]').text()).not.toContain('since acquisition')
    expect(view.findComponent({ name: 'PortfolioValueChart' }).props('history')).toEqual({change:25,captureWarnings:[]})
    view.unmount()
  })

  it('uses the selected currency and date range for the same change shown by the chart', async () => {
    const view = create()
    await flushPromises()
    await view.find('[data-period="30d"]').trigger('click')
    await flushPromises()
    useAuthStore().user.settings.display_currency='USD'
    await flushPromises()
    expect(view.find('article').text()).toContain('$100.00')
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
    useAuthStore().user.settings.display_currency='USD';await flushPromises()
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
  it('shows identified quote sessions on large and tiny tiles alongside independent delay markers',async()=>{
    const assets=[['PRE','pre',80],['POST','post',80],['NIGHT','overnight',.01],['UNKNOWN',null,80],['CRYPTO','continuous',80]]
      .map(([symbol,quoteSession,value])=>({symbol,quoteSession,value,priceAsOf:new Date(Date.now()-960000).toISOString(),assetClass:'Stocks',sector:'Technology',industry:'Software'}));
    mock.get.mockImplementation(async url=>({data:url.endsWith('/dashboard')?{...dashboard,holdings:assets}:{change:25}}));
    const view=create();await flushPromises();
    expect(view.findAll('.quote-session-marker').map(m=>m.attributes('title'))).toEqual(expect.arrayContaining(['Pre-market quote','Post-market quote','Overnight quote']));
    expect(view.findAll('.quote-session-marker')).toHaveLength(3);
    expect(view.findAll('.quote-delay-marker')).toHaveLength(5);
    view.unmount();
  });
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

it('loads EUR settings currency and offers EUR, GBP and USD card buttons',async()=>{
 useAuthStore().user.settings.display_currency='EUR';
 const view=create();await flushPromises();
 expect(mock.get.mock.calls.find(([url])=>url.endsWith('/dashboard'))[1].params.currency).toBe('EUR');
 expect(view.find('article').text()).toContain('€100.00');
 const button=view.find('button.currency-toggle');expect(button.text()).toBe('€');
 await button.trigger('click');expect(button.text()).toBe('£');view.unmount();
});
it('keeps a recovery currency button available when portfolio loading fails',async()=>{
 useAuthStore().user.settings.display_currency='EUR';
 mock.get.mockImplementation(async(url,options)=>{
 if(url.endsWith('/display-fx'))return {data:{rates:{USD:1,GBP:.8,EUR:.9}}};
 if(url.endsWith('/dashboard')&&options.params.currency==='EUR')throw Error('Conversion unavailable');
 return {data:url.endsWith('/dashboard')?dashboard:{change:0}};
 });
 const view=create();await flushPromises();expect(view.find('[role="alert"]').exists()).toBe(true);
 await view.find('button.currency-toggle').trigger('click');await flushPromises();
 expect(view.find('article').exists()).toBe(true);expect(useAuthStore().user.settings.display_currency).toBe('EUR');view.unmount();
});


it('keeps the independent sync card mounted with no accounts selected or portfolio loading failure',async()=>{
 mock.selection.value='__none__';const view=create();await flushPromises();
 expect(view.find('template').exists()).toBe(false);
 expect(view.find('broker-sync-status-card-stub').exists()).toBe(true);
 mock.selection.value='one';mock.get.mockRejectedValue(new Error('offline'));await flushPromises();
 expect(view.find('template').exists()).toBe(false);
 expect(view.find('broker-sync-status-card-stub').exists()).toBe(true);view.unmount();
});


it('requests new period calculations when the heatmap card currency changes',async()=>{
 const view=create();await flushPromises();
 const card=view.findAllComponents({name:'CurrencyCard'}).find(c=>c.props('preferenceKey')==='portfoliodashboardview-5');
 expect(card).toBeTruthy();await card.find('button.currency-toggle').trigger('click');await flushPromises();
 expect(mock.get.mock.calls.filter(([url])=>url.endsWith('/dashboard')).at(-1)[1].params.currency).toBe('USD');
 view.unmount();
});
