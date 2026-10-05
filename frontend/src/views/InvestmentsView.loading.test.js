import { beforeEach, expect, it, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
const state = vi.hoisted(() => ({ store: null, tab: 'holdings', pollers: [] }))
vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: {}, isAuthenticated: true }) }))
vi.mock('@/stores/investments', () => ({ useInvestmentsStore: () => state.store }))
vi.mock('@/stores/scanner', () => ({ useScannerStore: () => ({ selectedPillars: [], loading: false }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { tab: state.tab } }), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/composables/useGlobalAccountFilter', () => ({ useGlobalAccountFilter: () => ({ selectedAccount: ref(null), selectedAccountLabel: ref('All Accounts'), accounts: ref([]), fetchAccounts: vi.fn(), setAccount: vi.fn(), clearAccount: vi.fn() }) }))
vi.mock('@/composables/useNotification', () => ({ useNotification: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }))
vi.mock('@/composables/useCurrencyFormatter', () => ({ useCurrencyFormatter: () => ({ formatCurrency: value => `$${value}` }) }))
vi.mock('@/composables/useVisibilityPolling', () => ({ useVisibilityPolling: callback => {
  const poller = { callback, start: vi.fn(), stop: vi.fn() }
  state.pollers.push(poller)
  return poller
} }))
import InvestmentsView from './InvestmentsView.vue'
beforeEach(() => {
  state.tab = 'holdings'
  state.pollers = []
  state.store = reactive({
    searchHistory: [], portfolioLoading: true, portfolioPositions: [], portfolioOverview: null,
    portfolioPerformance: null, portfolioRebalance: null, portfolioAlertSummary: null,
    fetchPortfolioPreferences: vi.fn().mockResolvedValue({}), fetchSearchHistory: vi.fn().mockResolvedValue([]),
    fetchPortfolioOverview: vi.fn(async () => { state.store.portfolioOverview = { totalValue: 100, allocationBySector: [], allocationByAssetType: [] } }),
    fetchPortfolioPositions: vi.fn(async () => { state.store.portfolioPositions = [{ symbol: 'MSFT', currentValue: 100, currentPrice: 100 }]; return state.store.portfolioPositions }),
    fetchPortfolioPerformance: vi.fn(() => new Promise(() => {})),
    fetchPortfolioRebalance: vi.fn(async () => { state.store.portfolioRebalance = { positions: [{ symbol: 'MSFT', currentValue: 100, currentPrice: 100 }] } }),
    fetchPortfolioAlerts: vi.fn(() => new Promise(() => {})),
  })
})
it('shows Holdings while optional benchmark and alerts are still pending', async () => {
  const wrapper = shallowMount(InvestmentsView)
  await flushPromises()
  expect(wrapper.text()).toContain('Loading historical benchmark data')
  expect(wrapper.text()).toContain('MSFT')
  expect(wrapper.text()).not.toContain('Loading portfolio data')
  wrapper.unmount()
})
it('does not request Holdings data when opened on another investment tab', async () => {
  state.tab = 'screener'
  const wrapper = shallowMount(InvestmentsView)
  await flushPromises()
  expect(state.store.fetchPortfolioOverview).not.toHaveBeenCalled()
  expect(state.store.fetchPortfolioPerformance).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('polls background history silently and stops once downloading finishes', async () => {
  state.store.fetchPortfolioPerformance.mockImplementation(async () => {
    state.store.portfolioPerformance = { series: [], historyUpdating: true }
    return state.store.portfolioPerformance
  })
  state.store.fetchPortfolioAlerts.mockResolvedValue({})
  const wrapper = shallowMount(InvestmentsView)
  await flushPromises()
  expect(wrapper.text()).toContain('Downloading missing historical prices')
  expect(state.pollers[1].start).toHaveBeenCalled()
  state.store.fetchPortfolioPerformance.mockImplementation(async () => {
    state.store.portfolioPerformance = { series: [], historyUpdating: false, historyIncomplete: true }
    return state.store.portfolioPerformance
  })
  await state.pollers[1].callback()
  await flushPromises()
  expect(state.store.fetchPortfolioPerformance).toHaveBeenLastCalledWith(expect.any(Object), { silent: true })
  expect(state.pollers[1].stop).toHaveBeenCalled()
  expect(wrapper.text()).toContain('Historical price coverage is incomplete')
  wrapper.unmount()
})
