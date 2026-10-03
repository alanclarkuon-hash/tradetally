import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import KrakenConnectionModal from './KrakenConnectionModal.vue'

describe('Kraken connection', () => {
  it('submits credentials only through the save event with masked inputs', async () => {
    const wrapper = mount(KrakenConnectionModal)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    for (const id of ['#kraken-key', '#kraken-secret']) {
      expect(wrapper.get(id).attributes('type')).toBe('password')
    }
    await wrapper.get('#kraken-key').setValue(' synthetic-key ')
    await wrapper.get('#kraken-secret').setValue(' synthetic-secret ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')[0][0]).toEqual({ api_key: 'synthetic-key', api_secret: 'synthetic-secret', account_label: '' })
    expect(wrapper.text()).not.toContain('synthetic-secret')
  })

  it('shows permission failures and always allows closing while a key is being checked', async () => {
    const wrapper = mount(KrakenConnectionModal, { props: { loading: true, error: 'Use a read-only key' } })
    expect(wrapper.get('[role="alert"]').text()).toBe('Use a read-only key')
    await wrapper.get('[aria-label="Close Kraken connection"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
