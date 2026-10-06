import { defineStore } from 'pinia'
import { ref, watch, onScopeDispose } from 'vue'
import { useUiPreferencesStore } from './uiPreferences'
import { dashboardDateRangeOptions, profileCalendarDate } from '@/utils/datePresets'
import { formatLocalDate } from '@/utils/date'

// Keep the existing synced keys so saved Trading preferences become the shared
// selection without a migration or a second competing preference.
const keys = { timeRange: 'dashboardTimeRange', startDate: 'dashboardCustomStartDate', endDate: 'dashboardCustomEndDate' }
export const useDashboardDateFilterStore = defineStore('dashboardDateFilter', () => {
  const preferences = useUiPreferencesStore()
  const selection = ref({ timeRange: 'all', startDate: '', endDate: '' })
  let hydrating = false
  function hydrate(reset = false) {
    hydrating = true
    try {
      const preset = reset ? 'all' : localStorage.getItem(keys.timeRange) || 'all'
      selection.value = {
        timeRange: dashboardDateRangeOptions.some(option => option.value === preset) ? preset : 'all',
        startDate: reset ? '' : localStorage.getItem(keys.startDate) || '',
        endDate: reset ? '' : localStorage.getItem(keys.endDate) || ''
      }
    } catch { selection.value = { timeRange: 'all', startDate: '', endDate: '' } }
    finally { hydrating = false }
  }
  hydrate()
  function selectPreset(timeRange, timezone = 'UTC') {
    const today = formatLocalDate(profileCalendarDate(new Date(), timezone))
    selection.value = { ...selection.value, timeRange,
      startDate: selection.value.startDate || today.slice(0, 4) + '-01-01',
      endDate: selection.value.endDate || today }
  }
  watch(selection, value => {
    if (hydrating) return
    try {
      for (const [field, key] of Object.entries(keys)) {
        localStorage.setItem(key, value[field])
        preferences.notifyChanged(key, value[field])
      }
    } catch { /* Storage can be unavailable; the in-session selection still works. */ }
  }, { deep: true, flush: 'sync' })
  // Settings are hydrated on sign-in. Clear the shared session on logout and
  // hydrate the next user's saved selection after their preferences load.
  watch(() => preferences.initialized, ready => hydrate(!ready))
  const onStorage = event => {
    if (event.key === null || Object.values(keys).includes(event.key)) hydrate()
  }
  window.addEventListener('storage', onStorage)
  onScopeDispose(() => window.removeEventListener('storage', onStorage))
  return { selection, selectPreset }
})
