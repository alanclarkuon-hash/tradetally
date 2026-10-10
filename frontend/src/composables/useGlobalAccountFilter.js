import { ref, computed, watch } from 'vue'
import api from '@/services/api'
import { useUiPreferencesStore } from '@/stores/uiPreferences'
import { useAccountsStore } from '@/stores/accounts'
import {accountSelection,EMPTY_ACCOUNTS} from '@/utils/accountSelection'

export const STORAGE_KEY = 'tradetally_global_account'

// Special filter value for trades without an account
export const UNSORTED_ACCOUNT = '__unsorted__'

// Shared state (singleton pattern - state persists across all component instances)
const selectedAccount = ref(null)
const accounts = ref([])
const loading = ref(false)
const initialized = ref(false)

function normalizeStoredAccount(value) {
  if (value == null) return null

  const normalized = String(value).trim()
  if (!normalized || normalized === 'null' || normalized === 'undefined') {
    return null
  }

  return normalized
}

function getAccountFilterValue(account) {
  return normalizeStoredAccount(account?.accountIdentifier || account?.account_name || account?.accountName)
}

function redactAccountId(accountId) {
  if (!accountId) return null

  const str = String(accountId).trim()
  if (str.length <= 4) return str

  const withoutSeparators = str.replace(/[-.\s]/g, '')
  const digitCount = (withoutSeparators.match(/\d/g) || []).length
  const letterCount = (withoutSeparators.match(/[a-zA-Z]/g) || []).length
  const totalAlphanumeric = digitCount + letterCount

  const isAccountNumber = totalAlphanumeric > 0 && (
    (digitCount / totalAlphanumeric) > 0.5 ||
    /^[A-Za-z]{1,2}\d{4,}/.test(withoutSeparators)
  )

  if (isAccountNumber) {
    return `****${str.slice(-4)}`
  }

  return str
}

export function useGlobalAccountFilter() {
  // Initialize from localStorage on first use
  if (!initialized.value) {
    const stored = normalizeStoredAccount(localStorage.getItem(STORAGE_KEY))
    if (stored) {
      selectedAccount.value = stored
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    initialized.value = true
  }

  const selectedAccountLabel = computed(() => {
    const selection=accountSelection(selectedAccount.value)
    if(selection?.length===0)return 'No accounts selected'
    if(selection?.length>1)return `${selection.length} accounts selected`
    if (selectedAccount.value === UNSORTED_ACCOUNT) {
      return 'Unsorted'
    }

    if (!selectedAccount.value) {
      return 'All Accounts'
    }

    const matchingAccount = accounts.value.find(account => account.value === selectedAccount.value)
    return matchingAccount?.label || redactAccountId(selectedAccount.value) || selectedAccount.value
  })

  const isFiltered = computed(() => {
    return selectedAccount.value !== null && selectedAccount.value !== ''
  })

  // Managed accounts come from the accounts store (shared cache + in-flight
  // de-duplication) when Pinia is active; unit tests exercise this composable
  // without Pinia, so fall back to a direct API call there.
  async function fetchManagedAccounts(force) {
    let accountsStore = null
    try {
      accountsStore = useAccountsStore()
    } catch (_) {
      // no active Pinia (test context) — use the API directly below
    }

    if (accountsStore) {
      const managed = await accountsStore.fetchAccounts({ force })
      return managed || []
    }

    const response = await api.get('/accounts')
    return response.data.data || []
  }

  async function fetchAccounts(options = {}) {
    if (loading.value) return
    const force = options.force === true
    loading.value = true
    try {
      const [tradeAccountsResult, managedAccountsResult] = await Promise.allSettled([
        api.get('/trades/accounts'),
        fetchManagedAccounts(force)
      ])

      const tradeAccounts = tradeAccountsResult.status === 'fulfilled'
        ? (tradeAccountsResult.value.data.accounts || [])
        : []
      const managedAccounts = managedAccountsResult.status === 'fulfilled'
        ? (managedAccountsResult.value || [])
        : []

      const managedAccountMap = new Map(
        managedAccounts
          .map(account => [getAccountFilterValue(account), account])
          .filter(([value]) => Boolean(value))
      )

      const accountIdentifiers = Array.from(new Set([
        ...tradeAccounts.map(normalizeStoredAccount).filter(Boolean),
        ...managedAccounts.map(getAccountFilterValue).filter(Boolean)
      ])).sort((a, b) => a.localeCompare(b))

      accounts.value = accountIdentifiers.map(identifier => {
        const managedAccount = managedAccountMap.get(identifier)
        const redactedIdentifier = redactAccountId(identifier)

        return {
          value: identifier,
          label: managedAccount?.accountName || redactedIdentifier || identifier,
          secondaryLabel: managedAccount?.accountName && managedAccount.accountName !== identifier
            ? redactedIdentifier
            : null,
          currency: managedAccount?.currency || null,
          isPrimary: Boolean(managedAccount?.isPrimary)
        }
      })

      const hasAccountData = tradeAccountsResult.status === 'fulfilled' || managedAccountsResult.status === 'fulfilled'

      // Validate stored selection still exists (allow special UNSORTED_ACCOUNT value)
      if (hasAccountData && selectedAccount.value && selectedAccount.value !== EMPTY_ACCOUNTS && selectedAccount.value !== UNSORTED_ACCOUNT && !accounts.value.some(account => account.value === selectedAccount.value)) {
        const selection=accountSelection(selectedAccount.value)
        if(selection?.length>1){setAccounts(selection.filter(value=>value===UNSORTED_ACCOUNT||accounts.value.some(a=>a.value===value)));return}
        console.log('[GLOBAL ACCOUNT] Stored account no longer exists, clearing filter')
        clearAccount()
      }
    } catch (error) {
      console.error('[GLOBAL ACCOUNT] Failed to fetch accounts:', error)
      accounts.value = []
    } finally {
      loading.value = false
    }
  }

  // Pinia may not be installed when this composable is exercised from a unit
  // test, so swallow the lookup error rather than crashing the caller.
  function notifyPreferenceChange(value) {
    try {
      useUiPreferencesStore().notifyChanged(STORAGE_KEY, value)
    } catch (_) {
      // no active Pinia (test context) — local write is enough
    }
  }

  function setAccount(accountId) {
    if(Array.isArray(accountId)){setAccounts(accountId);return}
    const normalized = normalizeStoredAccount(accountId)
    selectedAccount.value = normalized
    if (normalized) {
      localStorage.setItem(STORAGE_KEY, normalized)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    notifyPreferenceChange(normalized || null)
    console.log('[GLOBAL ACCOUNT] Set to:', normalized || 'All Accounts')
  }

  const selectedAccounts=computed(()=>accountSelection(selectedAccount.value))
  function setAccounts(values){setAccount(values===null?null:[...new Set(values)].sort().join(',')||EMPTY_ACCOUNTS)}
  function isAccountSelected(value){return selectedAccounts.value===null||selectedAccounts.value.includes(value)}
  function toggleAccount(value){
    const current=selectedAccounts.value??[...accounts.value.map(a=>a.value),UNSORTED_ACCOUNT]
    setAccounts(current.includes(value)?current.filter(v=>v!==value):[...current,value])
  }

  function clearAccount() {
    selectedAccount.value = null
    localStorage.removeItem(STORAGE_KEY)
    notifyPreferenceChange(null)
    console.log('[GLOBAL ACCOUNT] Cleared - showing all accounts')
  }

  return {
    selectedAccount,
    selectedAccounts,
    selectedAccountLabel,
    accounts,
    loading,
    isFiltered,
    fetchAccounts,
    setAccount,
    setAccounts,
    isAccountSelected,
    toggleAccount,
    clearAccount,
    UNSORTED_ACCOUNT
  }
}
