import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortfolioDashboardView from './PortfolioDashboardView.vue'

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), change: 25, fail: false }))
vi.mock('@/services/api', () => ({ default: mock }))
vi.mock('@/composables/useGlobalAccountFilter', async () => {
  const { ref } = await import('vue')
  return { useGlobalAccountFilter: () => ({ accounts: ref([]), selectedAccount: ref(null), fetchAccounts: vi.fn() }) }
})

const dashboard = { accountCount: 1, asOf: '2026-10-04T12:00:00Z', holdings: [],
  totals: { portfolioValue: 100, holdingsValue: 60, cashValue: 40, stablecoinValue: 0, pnl: 0, pnlPercent: 0 },
  coverage: { missingCash: 0, missingPrices: 0, missingPnl: 0, unclassified: 0 } }
const create = () => mount(PortfolioDashboardView, { global: { stubs: { RouterLink: true, PortfolioValueChart: true } } })

beforeEach(() => {
  vi.clearAllMocks()
  mock.change = 25
  mock.fail = false
  mock.post.mockResolvedValue({ data: {} })
  mock.get.mockImplementation(async url => {
    if (url.endsWith('/dashboard')) return { data: dashboard }
    if (mock.fail) throw Error('History unavailable')
    return { data: { change: mock.change } }
  })
})

describe('Portfolio value card', () => {
  it.each([25, -25, 0])('shows the chart change %s including zero and losses', async change => {
    mock.change = change
    const view = create()
    await flushPromises()
    const card = view.find('article')
    expect(card.text()).toContain(`${change >= 0 ? '+' : '−'}£${Math.abs(change).toFixed(2)}`)
    expect(card.text()).toContain('Includes deposits and withdrawals')
    expect(card.text()).not.toContain('change unavailable')
    view.unmount()
  })

  it('uses the selected currency and date range for the same change shown by the chart', async () => {
    const view = create()
    await flushPromises()
    await view.find('#portfolio-period').setValue('month')
    await flushPromises()
    await view.find('#portfolio-currency').setValue('USD')
    await flushPromises()
    expect(view.find('article').text()).toContain('+US$25.00')
    expect(view.find('article').text()).toContain('selected period')
    const params = mock.get.mock.calls.filter(([url]) => url.endsWith('/value-history')).at(-1)[1].params
    expect(params.currency).toBe('USD')
    expect(params.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(params.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    view.unmount()
  })

  it('does not display an old change when refreshed history fails', async () => {
    const view = create()
    await flushPromises()
    mock.fail = true
    await view.find('.refresh').trigger('click')
    await flushPromises()
    expect(view.find('article').text()).toContain('Portfolio period change unavailable')
    expect(view.find('article').text()).not.toContain('+£25.00')
    view.unmount()
  })
})
