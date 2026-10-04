import {describe,it,expect} from 'vitest'
import {accountSelection,matchesAccount,singleAccount} from './accountSelection'
describe('shared account selection',()=>{
  it('includes unlinked trades alongside named accounts without including other accounts',()=>{
    expect(matchesAccount('one,__unsorted__','one')).toBe(true)
    expect(matchesAccount('one,__unsorted__',null)).toBe(true)
    expect(matchesAccount('one,__unsorted__','')).toBe(true)
    expect(matchesAccount('one,__unsorted__','two')).toBe(false)
    expect(matchesAccount('__none__',null)).toBe(false)
    expect(matchesAccount(null,'two')).toBe(true)
    expect(accountSelection(' one, two,one ')).toEqual(['one','two'])
  })
  it('never assigns a multiple or empty account filter to a new trade',()=>{
    expect(singleAccount('one')).toBe('one')
    for(const value of ['one,two','one,__unsorted__','__none__','__unsorted__',null])expect(singleAccount(value)).toBe('')
  })
})
