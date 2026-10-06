import { formatLocalDate } from './date'

export const monthPresetOptions = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' }
]

export const dashboardDateRangeOptions = [
  { value: 'this_week', label: 'This Week' },
  ...monthPresetOptions,
  { value: 'all', label: 'All Time' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'custom', label: 'Custom Range' }
]

export function profileCalendarDate(now = new Date(), timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = type => Number(parts.find(part => part.type === type).value)
  return new Date(value('year'), value('month') - 1, value('day'), 12)
}

// Resolve calendar dates locally; never convert them through UTC.
export function resolveDatePreset(preset, now = new Date(), timezone = null) {
  if (timezone) now = profileCalendarDate(now, timezone)
  const start = new Date(now)
  let end = new Date(now)
  switch (preset) {
    case 'this_week': start.setDate(start.getDate() - (start.getDay() + 6) % 7); break
    case 'this_month': start.setDate(1); break
    case 'last_month':
      start.setDate(1)
      start.setMonth(start.getMonth() - 1)
      end = new Date(now.getFullYear(), now.getMonth(), 0)
      break
    case 'today': break
    case '7d': start.setDate(start.getDate() - 7); break
    case '30d': start.setDate(start.getDate() - 30); break
    case '90d': start.setDate(start.getDate() - 90); break
    case 'ytd': start.setMonth(0, 1); break
    case '1y': start.setFullYear(start.getFullYear() - 1); break
    default: return { start_date: '', end_date: '' }
  }
  return { start_date: formatLocalDate(start), end_date: formatLocalDate(end) }
}

export function legacyDateParams(preset, now) {
  const { start_date, end_date } = resolveDatePreset(preset, now)
  return { startDate: start_date, endDate: end_date }
}

export function resolveMonthlyFilterParams(filters, now) {
  const { date_preset, ...params } = filters
  if (['this_month', 'last_month'].includes(date_preset)) {
    Object.assign(params, legacyDateParams(date_preset, now))
  }
  return params
}
