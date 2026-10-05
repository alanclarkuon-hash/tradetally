import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TradeNewsSection from './TradeNewsSection.vue'
import api from '@/services/api'
vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/composables/useDashboardPrivacy', () => ({ useMonetaryPrivacy: () => ({ maskMoneyText: value => value }) }))
const article = { symbol: 'MSFT', id: 1, datetime: Math.floor(Date.now() / 1000), headline: 'Cached story', source: 'Example', url: 'https://example.com' }
const response = (items, pending = false) => ({ data: items, headers: { 'x-news-refresh-pending': String(pending) } })
describe('dashboard background news refresh', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
  afterEach(() => vi.useRealTimers())
  it('shows cached news immediately and polls the cache until refresh completes', async () => {
    api.get.mockResolvedValueOnce(response([article], true)).mockResolvedValueOnce(response([{ ...article, headline: 'Updated story' }]))
    const wrapper = mount(TradeNewsSection, { props: { symbols: ['MSFT'] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Cached story')
    expect(wrapper.text()).toContain('Updating news in the background')
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(wrapper.text()).toContain('Updated story')
    expect(wrapper.text()).not.toContain('Updating news in the background')
    wrapper.unmount()
  })
  it('queues manual refresh and cancels polling on unmount', async () => {
    api.get.mockResolvedValue(response([article]))
    api.post.mockResolvedValue(response([article], true))
    const wrapper = mount(TradeNewsSection, { props: { symbols: ['MSFT'] } })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/trades/news/refresh', { symbols: 'MSFT' })
    expect(wrapper.text()).toContain('Cached story')
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.get).toHaveBeenCalledTimes(1)
  })
  it('discards a late response after the account selection changes', async () => {
    let resolveOld
    api.get.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce(response([]))
    const wrapper = mount(TradeNewsSection, { props: { symbols: ['MSFT'] } })
    await wrapper.setProps({ symbols: ['AAPL'] })
    await flushPromises()
    resolveOld(response([article]))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Cached story')
    wrapper.unmount()
  })
})
