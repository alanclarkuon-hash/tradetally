import {describe,it,expect} from 'vitest'
import {cardCurrencies,convertAmount} from './cardCurrency'
const accounts=[{value:'one',currency:'GBP'},{value:'two',currency:'USD'},{value:'three',currency:'EUR'},{value:'four',currency:'USD'}]
describe('card currency choices and reporting conversions',()=>{
 it('starts with display currency and deduplicates selected account currencies',()=>{
  expect(cardCurrencies('GBP',accounts)).toEqual(['GBP','USD','EUR'])
  expect(cardCurrencies('EUR',accounts,'one,two')).toEqual(['EUR','GBP','USD'])
  expect(cardCurrencies('GBP',accounts,'three')).toEqual(['GBP','EUR'])
  expect(cardCurrencies('GBP',accounts,'__none__')).toEqual(['GBP'])
 })
 it('converts a known source once, including a third reporting currency',()=>{
  const rates={GBP:.8,EUR:.9}
  expect(convertAmount(80,'GBP','USD',rates)).toBe(100)
  expect(convertAmount(80,'GBP','EUR',rates)).toBe(90)
  expect(convertAmount(90,'EUR','GBP',rates)).toBe(80)
  expect(convertAmount(80,'GBP','GBP',{})).toBe(80)
 })
 it('does not relabel unsupported conversions or missing values',()=>{
  expect(convertAmount(0,'GBP','EUR',{})).toBeNull()
  expect(convertAmount(null,'USD','GBP',{GBP:.8})).toBeNull()
  expect(convertAmount('','USD','GBP',{GBP:.8})).toBeNull()
  expect(convertAmount(10,'USD','GBP',{GBP:0})).toBeNull()
 })
})
