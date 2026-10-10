import { computed, ref, watch, onMounted, unref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useGlobalAccountFilter } from './useGlobalAccountFilter'
import { useCurrencyFormatter } from './useCurrencyFormatter'
import { cardCurrencies, convertAmount } from '@/utils/cardCurrency'
import api from '@/services/api'
import {useMonetaryPrivacy, MONEY_MASK} from './useDashboardPrivacy'
const rates = ref({}), loadedAt = ref(0)
let pending
export async function loadCardRates() {
  if (loadedAt.value && Date.now() - loadedAt.value < 300000) return
  if (pending) return pending
  pending = api.get('/settings/display-fx').then(response => {
    rates.value = response.data?.rates || {}
    loadedAt.value = Date.now()
  }).catch(() => { /* Missing conversion is explicitly shown as unavailable. */ }).finally(() => pending = null)
  return pending
}
export function useCardCurrency(sourceCurrency, accountCurrencies) {
  const auth = useAuthStore()
  const { accounts, selectedAccount, fetchAccounts } = useGlobalAccountFilter()
  const formatter = useCurrencyFormatter()
  const {hideAmounts} = useMonetaryPrivacy()
  const displayCurrency = computed(() => String(auth.user?.settings?.display_currency || 'USD').toUpperCase())
  const choices = computed(() => [...new Set([...cardCurrencies(displayCurrency.value, accounts.value, selectedAccount.value), ...(unref(accountCurrencies) || []).filter(Boolean).map(c=>String(c).toUpperCase())])])
  const currency = ref(displayCurrency.value)
  watch(displayCurrency, value => currency.value = value)
  watch(choices, value => { if (!value.includes(currency.value)) currency.value = displayCurrency.value })
  onMounted(() => { loadCardRates(); if (!accounts.value.length) fetchAccounts() })
  const convert = (value, from = unref(sourceCurrency) || displayCurrency.value, to = currency.value) => convertAmount(value, from, to, rates.value)
  function formatCurrency(value, options = {}) {
    if (hideAmounts.value) return MONEY_MASK
    if (value == null || value === '' || !Number.isFinite(Number(value))) return formatter.formatCurrency(null)
    const amount = convert(value, options.currency || unref(sourceCurrency) || displayCurrency.value)
    return amount == null ? 'FX unavailable' : formatter.formatCurrency(amount, { ...options, currency: currency.value })
  }
  function formatSignedCurrency(value, options = {}) {
    if (hideAmounts.value) return MONEY_MASK
    if (value == null || !Number.isFinite(Number(value))) return formatter.formatCurrency(null)
    const formatted = formatCurrency(Math.abs(value), options)
    if (formatted === 'FX unavailable' || formatted === formatter.formatCurrency(null)) return formatted
    return (Number(value) >= 0 ? '+' : '-') + formatted
  }
  return { currency, choices, convert, formatCurrency, formatSignedCurrency, rates, displayCurrency, currencySymbol: computed(() => formatter.symbolFor(currency.value)) }
}
