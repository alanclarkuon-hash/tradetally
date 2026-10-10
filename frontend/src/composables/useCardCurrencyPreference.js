import { computed, ref, watch, unref } from 'vue'
const revision = ref(0)
const memory = new Map()
const storageKey = user => `tradetally.cardCurrencies.${user?.id || user?.username || 'guest'}`
function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {} } catch { return memory.get(key) || {} }
}
function write(key, value) {
  memory.set(key, value)
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Preferences still work for this session. */ }
  revision.value++
}
export function observeCardCurrencyDefault(auth) {
  watch(() => [auth.user?.id || auth.user?.username, auth.user?.settings?.display_currency], () => {
    if (!auth.user) return
    const key = storageKey(auth.user), currency = String(auth.user.settings?.display_currency || 'USD').toUpperCase()
    const saved = read(key)
    if (saved.displayCurrency !== currency) write(key, {displayCurrency: currency, cards: {}})
  }, {immediate: true, flush: 'sync'})
}
export function useCardCurrencyPreference(auth, cardKey, choices) {
  observeCardCurrencyDefault(auth)
  return computed({
    get() {
      revision.value
      const display = String(auth.user?.settings?.display_currency || 'USD').toUpperCase()
      const saved = read(storageKey(auth.user))
      const selected = saved.displayCurrency === display ? saved.cards?.[unref(cardKey)] : null
      return selected && (!choices || unref(choices).includes(selected)) ? selected : display
    },
    set(currency) {
      const key = storageKey(auth.user), saved = read(key)
      write(key, {...saved, cards: {...saved.cards, [unref(cardKey)]: currency}})
    }
  })
}
