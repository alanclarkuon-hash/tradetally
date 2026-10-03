import {mount, flushPromises} from '@vue/test-utils'
import {describe, expect, it, vi} from 'vitest'
import api from '@/services/api'
import TransferLinks from './TransferLinks.vue'
vi.mock('@/services/api', () => ({default: {get: vi.fn()}}))
describe('Transfer links', () => {
  it('shows native received amounts and separate fees without rounding small coin balances', async () => {
    api.get.mockResolvedValue({data: {matches: [{id:'synthetic',source_broker:'kraken',destination_broker:'okx',
      sent_at:'2026-01-01T00:00:00Z',asset:'USDT',quantity:'12.1234567890123456',source_fee:'0.1000000000000000'}],
      unmatched:[{date:'2025-01-01',broker:'kraken',direction:'in',quantity:'0.0000000000000001',asset:'BTC'}],notice:'Audit only'}})
    const wrapper=mount(TransferLinks);await flushPromises()
    expect(wrapper.text()).toContain('Kraken → OKX')
    expect(wrapper.text()).toContain('12.1234567890123456 USDT')
    expect(wrapper.text()).toContain('0.1 USDT')
    expect(wrapper.text()).toContain('0.0000000000000001 BTC')
    expect(api.get).toHaveBeenCalledWith('/broker-sync/transfers')
  })
  it('shows a recoverable error when private records cannot load', async () => {
    api.get.mockRejectedValue(Error('private error must not be displayed'))
    const wrapper=mount(TransferLinks);await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded')
    expect(wrapper.text()).not.toContain('private error')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })
})
