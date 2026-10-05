import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import BackupFailureBanner from './BackupFailureBanner.vue'
const mock = vi.hoisted(() => ({ get: vi.fn(), auth: null }))
vi.mock('@/services/api', () => ({ default: mock }))
vi.mock('@/stores/auth', async () => {
  const { reactive } = await import('vue')
  mock.auth = reactive({ isAuthenticated: true, user: { id: 'synthetic-admin', role: 'admin' } })
  return { useAuthStore: () => mock.auth }
})
const create = () => mount(BackupFailureBanner, { global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  mock.auth.isAuthenticated = true; mock.auth.user = { id: 'synthetic-admin', role: 'admin' }
  mock.get.mockResolvedValue({ data: { failed: false, failedAt: null } })
})
afterEach(() => vi.useRealTimers())
describe('backup failure banner', () => {
  it('shows an immediate prominent warning with a review link and no dismiss control', async () => {
    mock.get.mockResolvedValue({ data: { failed: true, failedAt: '2026-01-01T12:00:00Z' } })
    const view = create(); await flushPromises()
    expect(mock.get).toHaveBeenCalledWith('/admin/backup/failure-status')
    expect(view.find('[role="alert"]').exists()).toBe(true)
    expect(view.text()).toContain('Backup failed')
    expect(view.find('a').attributes('href')).toBe('/admin/backups')
    expect(view.find('button').exists()).toBe(false)
    view.unmount()
  })
  it('clears the warning after a successful backup, but retains it when polling fails', async () => {
    mock.get.mockResolvedValueOnce({ data: { failed: true, failedAt: null } })
    const view = create(); await flushPromises()
    mock.get.mockRejectedValueOnce(Error('synthetic network failure'))
    await vi.advanceTimersByTimeAsync(60000); await flushPromises()
    expect(view.text()).toContain('Backup failed')
    await vi.advanceTimersByTimeAsync(60000); await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    view.unmount()
  })
  it('checks when admin identity finishes loading and stops on logout', async () => {
    mock.auth.user = null
    const view = create(); await flushPromises()
    expect(mock.get).not.toHaveBeenCalled()
    mock.get.mockResolvedValue({ data: { failed: true, failedAt: null } })
    mock.auth.user = { id: 'synthetic-admin', role: 'admin' }; await flushPromises()
    expect(view.text()).toContain('Backup failed')
    mock.auth.isAuthenticated = false; await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    const count = mock.get.mock.calls.length
    await vi.advanceTimersByTimeAsync(120000)
    expect(mock.get).toHaveBeenCalledTimes(count)
    view.unmount()
  })
  it('never polls for non-admin users', async () => {
    mock.auth.user.role = 'user'
    const view = create(); await flushPromises()
    expect(mock.get).not.toHaveBeenCalled()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    view.unmount()
  })
  it('ignores a failure response that arrives after logout', async () => {
    let resolve
    mock.get.mockImplementation(() => new Promise(done => { resolve = done }))
    const view = create(); await flushPromises()
    mock.auth.isAuthenticated = false
    resolve({ data: { failed: true, failedAt: null } }); await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    view.unmount()
  })
})