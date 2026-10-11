// A plan row can contain fills from several broker-matched trade records.
// Preserve the plan's row order; source timestamps only order the drill-down.
export function planTradeGroups(definition, records, action) {
 const source = (records || []).filter(r => r.action === action && !r.fill?.provisional)
 const planned = action === 'entry' ? definition.entries || [] : definition.exits || []
 const keys = [...new Set([...planned.map(r => r.key), ...source.map(r => r.stage_key)])]
 return keys.flatMap(key => {
  const fills = source.filter(r => r.stage_key === key).slice().sort((a,b) => String(a.fill?.time || '').localeCompare(String(b.fill?.time || '')))
  if (!fills.length) return []
  return [{key, label: planned.find(r => r.key === key)?.label || (key === 'runner' ? 'Runner' : key), fills,
   quantity: fills.reduce((sum,r) => sum + Number(r.quantity), 0), valid: fills.every(r => r.valid)}]
 })
}

export function groupPrice(group, currency, fillRate) {
 if (!group.valid || !(group.quantity > 0)) return null
 const rates = group.fills.map(r => fillRate(r.fill, currency))
 if (rates.some(r => !(r > 0))) return null
 return group.fills.reduce((sum,r,i) => sum + r.quantity * r.fill.price * rates[i], 0) / group.quantity
}

export function groupAmount(group, action, currency, rate) {
 if (!group.valid) return null
 const amounts = group.fills.map(r => {
  const account = !!r.accountCurrency
  const value = account ? (action === 'entry' ? r.accountPositionValue : r.accountRealisedProfit)
   : (action === 'entry' ? r.positionValue : r.realisedProfit)
  const factor = rate(account ? r.accountCurrency : r.fill.currency, currency)
  return value != null && Number.isFinite(Number(value)) && factor > 0 ? Number(value) * factor : null
 })
 return amounts.some(v => v == null) ? null : amounts.reduce((sum,v) => sum + v, 0)
}
