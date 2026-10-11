import { accountSelection } from './accountSelection'
export function cardCurrencies(displayCurrency, accounts = [], selection = null) {
  const selected = accountSelection(selection)
  const codes = [displayCurrency || 'USD', ...accounts.filter(a => selected === null || selected.includes(a.value ?? a.accountIdentifier ?? a.id)).map(a => a.currency)].filter(Boolean).map(c => String(c).toUpperCase())
  return [...new Set(codes)]
}
export function crossRate(rates, from, to) {
  if (from === to) return 1
  const all = { USD: 1, ...rates }
  return Number(all[from]) > 0 && Number(all[to]) > 0 ? Number(all[to]) / Number(all[from]) : null
}
export function convertAmount(value, from, to, rates) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null
  const rate = crossRate(rates, from, to)
  return rate == null ? null : Number(value) * rate
}
