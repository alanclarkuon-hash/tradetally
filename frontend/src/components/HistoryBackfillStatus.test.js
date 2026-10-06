import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import HistoryBackfillStatus from './HistoryBackfillStatus.vue'
import api from '@/services/api'
vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/composables/useVisibilityPolling', () => ({ useVisibilityPolling: fn => ({ start: fn, stop: vi.fn() }) }))
beforeEach(() => vi.clearAllMocks())
it('shows saved-quote refresh progress without confusing it with historical coverage',async()=>{
 api.get.mockResolvedValue({data:{data:[{status:'processing',mode:'broker_refresh',stage:'quotes',quoteProcessed:4,quoteTotal:10,processed:0,total:100,gaps:[],portfolioWarnings:[]}]}});
 const view=mount(HistoryBackfillStatus);await flushPromises();
 expect(view.text()).toContain('Refreshing saved quotes · 4/10 checked');
 expect(view.get('[role=progressbar]').attributes('aria-valuenow')).toBe('4');
 expect(view.get('[role=progressbar]').attributes('aria-valuemax')).toBe('10');view.unmount();
});
it('shows progress, prevents duplicate updates and lists unresolved dates', async () => {
  api.get.mockResolvedValue({ data: { data: [{ id: 'one', status: 'processing', stage: 'prices', currentSymbol: 'BTC', processed: 2, total: 4, complete: 1, gaps: [{ symbol: 'GAP', instrumentType: 'crypto', ranges: [{ from: '2026-01-01', to: '2026-01-02' }], reason: 'Unsupported dates' }], portfolioWarnings: [] }] } });
  const view = mount(HistoryBackfillStatus, { props: { allowUpdate: true } }); await flushPromises()
  expect(view.text()).toContain('Downloading BTC · 2/4 assets checked')
  expect(view.get('button').attributes('disabled')).toBeDefined()
  expect(view.text()).toContain('2026-01-01 to 2026-01-02')
  expect(view.get('[role=progressbar]').attributes('aria-valuenow')).toBe('2')
  view.unmount()
})
it('queues history independently of broker sync', async () => {
  api.get.mockResolvedValue({ data: { data: [] } }); api.post.mockResolvedValue({ data: { jobId: 'one' } })
  const view = mount(HistoryBackfillStatus, { props: { allowUpdate: true } }); await flushPromises()
  await view.get('button').trigger('click'); await flushPromises()
  expect(api.post).toHaveBeenCalledWith('/broker-sync/history/update')
  view.unmount()
})
it('shows listing-calendar lookup progress separately from price downloads',async()=>{
 api.get.mockResolvedValue({data:{data:[{status:'processing',stage:'calendars',currentSymbol:'ETF',processed:20,total:50,calendarProcessed:3,calendarTotal:8,gaps:[],portfolioWarnings:[]}]}})
 const view=mount(HistoryBackfillStatus); await flushPromises()
 expect(view.text()).toContain('Checking exchange calendar for ETF · 3/8 listings checked')
 view.unmount()
})
