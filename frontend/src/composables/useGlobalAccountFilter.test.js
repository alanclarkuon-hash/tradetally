import { describe, expect, it, vi } from 'vitest'

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn()
  }
}))

vi.mock('@/services/api', () => ({
  default: api
}))

async function loadComposable() {
  vi.resetModules()
  return import('./useGlobalAccountFilter')
}

describe('useGlobalAccountFilter', () => {
  it('persists multiple accounts, includes Unsorted, and keeps empty distinct from All Accounts',async()=>{
    localStorage.removeItem('tradetally_global_account')
    const {useGlobalAccountFilter}=await loadComposable()
    const filter=useGlobalAccountFilter()
    filter.setAccounts(['one','two','__unsorted__'])
    expect(filter.selectedAccounts.value).toEqual(['__unsorted__','one','two'])
    expect(filter.selectedAccountLabel.value).toBe('3 accounts selected')
    filter.toggleAccount('two')
    expect(filter.isAccountSelected('one')).toBe(true)
    expect(filter.isAccountSelected('two')).toBe(false)
    filter.toggleAccount('one');filter.toggleAccount('__unsorted__')
    expect(filter.selectedAccounts.value).toEqual([])
    expect(filter.selectedAccount.value).toBe('__none__')
    expect(filter.selectedAccountLabel.value).toBe('No accounts selected')
    const reloaded=(await loadComposable()).useGlobalAccountFilter()
    expect(reloaded.selectedAccounts.value).toEqual([])
    reloaded.clearAccount()
    expect(reloaded.selectedAccounts.value).toBeNull()
    expect(reloaded.isAccountSelected('__unsorted__')).toBe(true)
    expect(reloaded.selectedAccountLabel.value).toBe('All Accounts')
  })
  it('initializes from localStorage and persists account changes', async () => {
    localStorage.setItem('tradetally_global_account', ' 12345678 ')
    const { useGlobalAccountFilter } = await loadComposable()
    const filter = useGlobalAccountFilter()

    expect(filter.selectedAccount.value).toBe('12345678')
    expect(filter.selectedAccountLabel.value).toBe('****5678')

    filter.setAccount(' Schwab ')
    expect(filter.selectedAccount.value).toBe('Schwab')
    expect(localStorage.getItem('tradetally_global_account')).toBe('Schwab')

    filter.clearAccount()
    expect(filter.selectedAccount.value).toBe(null)
    expect(localStorage.getItem('tradetally_global_account')).toBe(null)
  })

  it('merges trade accounts and managed accounts into sorted selector options', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/trades/accounts') {
        return Promise.resolve({ data: { accounts: ['Z-9999', 'A-1111'], instrumentCurrencies: {'A-1111':['USD','EUR']} } })
      }
      if (url === '/accounts') {
        return Promise.resolve({
          data: {
            data: [
              { accountIdentifier: 'A-1111', accountName: 'Primary Account', currency:'GBP', isPrimary: true },
              { accountIdentifier: 'B-2222', accountName: 'Swing Account', currency:'USD', isPrimary: false }
            ]
          }
        })
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    const { useGlobalAccountFilter } = await loadComposable()
    const filter = useGlobalAccountFilter()
    await filter.fetchAccounts()

    expect(filter.accounts.value).toEqual([
      { value: 'A-1111', label: 'Primary Account', secondaryLabel: '****1111', currency:'GBP', isPrimary: true },
      { value: 'B-2222', label: 'Swing Account', secondaryLabel: '****2222', currency:'USD', isPrimary: false },
      { value: 'Z-9999', label: '****9999', secondaryLabel: null, currency:null, isPrimary: false }
    ])
  })

  it('clears a stored account that no longer exists', async () => {
    localStorage.setItem('tradetally_global_account', 'OLD-1234')
    api.get.mockResolvedValue({ data: { accounts: [] } })

    const { useGlobalAccountFilter } = await loadComposable()
    const filter = useGlobalAccountFilter()
    await filter.fetchAccounts()

    expect(filter.selectedAccount.value).toBe(null)
    expect(localStorage.getItem('tradetally_global_account')).toBe(null)
  })
})

describe('account listing failures',()=>{
 it.each(['/trades/accounts','/accounts'])('keeps persisted single and mixed selections when %s fails',async(failed)=>{
  for(const selection of ['valid-account','__unsorted__,one,two']){
   localStorage.setItem('tradetally_global_account',selection)
   api.get.mockImplementation(url=>url===failed?Promise.reject(new Error('offline')):Promise.resolve({data:{accounts:[],data:[]}}))
   const filter=(await loadComposable()).useGlobalAccountFilter()
   await filter.fetchAccounts()
   expect(filter.selectedAccount.value).toBe(selection)
   expect(localStorage.getItem('tradetally_global_account')).toBe(selection)
   expect(filter.error.value).toContain('selection has been kept')
  }
 })
 it('preserves previous options on total failure and validates deletion after a successful retry',async()=>{
  localStorage.setItem('tradetally_global_account','one,two')
  api.get.mockImplementation(()=>Promise.resolve({data:{accounts:['one','two'],data:[]}}))
  const filter=(await loadComposable()).useGlobalAccountFilter();await filter.fetchAccounts()
  api.get.mockRejectedValue(new Error('offline'));await filter.fetchAccounts()
  expect(filter.accounts.value.map(a=>a.value)).toEqual(['one','two']);expect(filter.selectedAccount.value).toBe('one,two')
  api.get.mockImplementation(()=>Promise.resolve({data:{accounts:['one'],data:[]}}));await filter.fetchAccounts({force:true})
  expect(filter.selectedAccount.value).toBe('one');expect(filter.error.value).toBeNull()
 })
})
