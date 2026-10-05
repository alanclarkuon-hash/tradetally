import { ref, provide, inject, getCurrentInstance } from 'vue'

export const MONEY_MASK = '••••'
export const DASHBOARD_PRIVACY = Symbol('dashboard-money-privacy')
const STORAGE_KEY = 'dashboardHideMoney'
const readPreference = () => {
  try { return localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
}
const hideAmounts = ref(readPreference())

export function useDashboardPrivacy() {
  provide(DASHBOARD_PRIVACY, hideAmounts)
  function toggle() {
    hideAmounts.value = !hideAmounts.value
    try { localStorage.setItem(STORAGE_KEY, String(hideAmounts.value)) } catch {}
  }
  return { hideAmounts, toggle }
}

// Scope masking to dashboard descendants; other screens keep their normal formatting.
export function useMonetaryPrivacy() {
  const hidden = getCurrentInstance() ? inject(DASHBOARD_PRIVACY, ref(false)) : ref(false)
  function maskMoneyText(text) {
    if (!hidden.value || text == null) return text
    return String(text).replace(/(?:[+−-]\s*)?(?:(?:US|CA|HK|NZ|A|S|R)?[$£€¥]|\b(?:GBP|USD|EUR|CAD|AUD|CHF)\s*)\s*[+−-]?\d[\d,]*(?:\.\d+)?(?:[KMBT]\b)?/g, MONEY_MASK)
  }
  return { hideAmounts: hidden, maskMoneyText }
}
