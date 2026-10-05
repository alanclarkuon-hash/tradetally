import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import BaseSelect from './BaseSelect.vue'

describe('BaseSelect clear option', () => {
  it('clears an existing value, emits change, and closes the dropdown', async () => {
    const wrapper = mount(BaseSelect, {
      props: { modelValue: 'codex_cli', placeholder: 'No provider',
        options: [{ value: 'codex_cli', label: 'OpenAI Codex CLI' }] },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === 'No provider').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
    expect(wrapper.emitted('change')).toEqual([['']])
    expect(wrapper.find('[data-base-select-panel]').exists()).toBe(false)
    await wrapper.setProps({ modelValue: '' })
    expect(wrapper.get('button').text()).toBe('No provider')
    wrapper.unmount()
  })

  it('still selects named options normally', async () => {
    const wrapper = mount(BaseSelect, {
      props: { modelValue: '', placeholder: 'No provider',
        options: [{ value: 'gemini', label: 'Google Gemini' }] },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === 'Google Gemini').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['gemini']])
    expect(wrapper.find('[data-base-select-panel]').exists()).toBe(false)
    wrapper.unmount()
  })
})
