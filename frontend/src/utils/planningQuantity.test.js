import {describe,it,expect} from 'vitest'
import {equal,exceeds} from './planningQuantity'
import cases from '../../../tests/fixtures/planning-quantity-tolerance.json'
describe('shared planning quantity boundary',()=>{it.each(cases)('$a / $b',c=>{expect(equal(c.a,c.b)).toBe(c.equal);expect(exceeds(c.a,c.b)).toBe(!c.equal&&c.a>c.b)})})
