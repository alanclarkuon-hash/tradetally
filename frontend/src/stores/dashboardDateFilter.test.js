import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useDashboardDateFilterStore } from './dashboardDateFilter'
import { useUiPreferencesStore } from './uiPreferences'
vi.mock('@/services/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }))
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })
describe('shared Trading and Portfolio dates', () => {
  it('shares preset and custom dates bidirectionally and persists the existing preference keys', () => {
    const trading = useDashboardDateFilterStore(), portfolio = useDashboardDateFilterStore()
    trading.selectPreset('this_week')
    expect(portfolio.selection.timeRange).toBe('this_week')
    portfolio.selection = { timeRange: 'custom', startDate: '2024-05-10', endDate: '2024-06-01' }
    expect(trading.selection).toEqual(portfolio.selection)
    expect(localStorage.getItem('dashboardTimeRange')).toBe('custom')
    expect(localStorage.getItem('dashboardCustomStartDate')).toBe('2024-05-10')
    portfolio.selectPreset('all')
    portfolio.selectPreset('custom')
    expect(trading.selection.startDate).toBe('2024-05-10')
    setActivePinia(createPinia())
    expect(useDashboardDateFilterStore().selection).toEqual(portfolio.selection)
  })
  it('hydrates legacy Trading dates and clears shared state between users', async () => {
    localStorage.setItem('dashboardTimeRange', 'custom')
    localStorage.setItem('dashboardCustomStartDate', '2023-01-02')
    localStorage.setItem('dashboardCustomEndDate', '2023-02-03')
    const preferences = useUiPreferencesStore(), dates = useDashboardDateFilterStore()
    expect(dates.selection.startDate).toBe('2023-01-02')
    preferences.initialized = true; await nextTick()
    preferences.reset(); await nextTick()
    expect(dates.selection).toEqual({ timeRange: 'all', startDate: '', endDate: '' })
    localStorage.setItem('dashboardTimeRange', 'this_week')
    preferences.initialized = true; await nextTick()
    expect(dates.selection.timeRange).toBe('this_week')
  })
  it('reflects a range changed in another browser tab without writing it back', () => {
    const dates = useDashboardDateFilterStore()
    localStorage.setItem('dashboardTimeRange', 'this_week')
    window.dispatchEvent(new StorageEvent('storage', { key: 'dashboardTimeRange', newValue: 'this_week' }))
    expect(dates.selection.timeRange).toBe('this_week')
  })
})
