const {currentSymbol,enrichPositions}=require('../../src/services/brokerSync/trading212Instruments');

test('current short ticker supersedes permanent US broker key without changing execution identity',()=>{
  const positions=[{instrument:{ticker:'OLD_US_EQ',isin:'US-EXAMPLE',name:'Old name'},quantity:3,walletImpact:{totalCost:30,currentValue:36}}];
  const result=enrichPositions(positions,[{ticker:'OLD_US_EQ',isin:'US-EXAMPLE',name:'Current name',shortName:'NEW'}]);
  expect(currentSymbol(result[0].instrument)).toBe('NEW');
  expect(result[0]).toEqual({...positions[0],instrument:{...positions[0].instrument,name:'Current name',shortName:'NEW'}});
  expect(positions[0].instrument.name).toBe('Old name');
});
test('preserves London exchange suffix and uses safe fallbacks for unavailable or invalid names',()=>{
  expect(currentSymbol({ticker:'OLDl_EQ',shortName:'NEW'})).toBe('NEW.L');
  expect(currentSymbol({ticker:'OLD_GB_EQ',shortName:'NEW.L'})).toBe('NEW.L');
  expect(currentSymbol({ticker:'OLD_US_EQ',shortName:'Company name'})).toBe('OLD');
  expect(currentSymbol({ticker:'OLDl_EQ'})).toBe('OLD.L');
  expect(currentSymbol({ticker:'OLDd_EQ',shortName:'NEW'})).toBe('OLDD_EQ');
});
test('joins catalogue by exact broker key, never by name or another listing, and guards ISIN mismatch',()=>{
  const positions=[{instrument:{ticker:'OLD_US_EQ',isin:'US-EXAMPLE'}}];
  expect(enrichPositions(positions,[{ticker:'NEW_US_EQ',shortName:'NEW',isin:'US-EXAMPLE'}])).toEqual(positions);
  expect(enrichPositions(positions,[{ticker:'OLD_US_EQ',shortName:'NEW',isin:'DIFFERENT'}])).toEqual(positions);
  expect(()=>enrichPositions(positions,[{ticker:'OLD_US_EQ'},{ticker:'OLD_US_EQ'}])).toThrow('Ambiguous');
});
