import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import View from './BackupManagementView.vue'
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/services/api', () => ({ default: api }))
vi.mock('@/composables/useUserTimezone', () => ({ useUserTimezone: () => ({ formatDateTime: value => value }) }))
vi.mock('@/composables/useNotification', () => ({ useNotification: () => ({ showDangerConfirmation: vi.fn() }) }))
const create = () => mount(View, { global: { stubs: { AdminNav: true, BaseSelect: true } } })
beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation(url => Promise.resolve({ data:
    url.endsWith('restore-limits') ? { maxUploadBytes: 100 } :
    url.endsWith('settings') ? { enabled: false, schedule: 'daily', retention_days: 30, health: {} } :
    url.endsWith('health') ? { services: {} } : { backups: [] }
  }))
})
describe('restore upload preflight', () => {
  it('uses the server cap and rejects oversized files before opening confirmation or uploading', async () => {
    const view = create(); await flushPromises()
    const input = view.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'.repeat(101)], 'large.json')], configurable: true })
    await input.trigger('change')
    expect(view.text()).toContain('upload limit')
    expect(view.text()).toContain('It has not been uploaded')
    expect(api.post).not.toHaveBeenCalled()
    view.unmount()
  })
  it('allows a file within the cap into the existing confirmation flow', async () => {
    const view = create(); await flushPromises()
    const input = view.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['{}'], 'small.json')], configurable: true })
    await input.trigger('change')
    expect(view.text()).toContain('small.json')
    expect(api.post).not.toHaveBeenCalled()
    view.unmount()
  })
})
