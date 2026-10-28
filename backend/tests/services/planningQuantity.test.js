const {equal,exceeds}=require('../../src/services/planningQuantity');
const cases=require('../../../tests/fixtures/planning-quantity-tolerance.json');
test.each(cases)('backend and frontend use the same quantity boundary: $a / $b',c=>{expect(equal(c.a,c.b)).toBe(c.equal);expect(exceeds(c.a,c.b)).toBe(!c.equal&&c.a>c.b)});
test('non-finite quantities cannot match',()=>{expect(equal(NaN,1)).toBe(false);expect(equal(Infinity,Infinity)).toBe(false)});
