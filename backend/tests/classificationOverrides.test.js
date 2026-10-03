jest.mock('fs',()=>({readFileSync:jest.fn(),statSync:jest.fn()}));
const fs=require('fs');
const {validateOverrides,applyOverrides}=require('../src/services/classificationOverrides');
const provider={symbol:'MSFT',source:'FinanceDatabase',sector_name:'Provider sector',industry_name:'Provider industry'};
beforeEach(()=>{fs.statSync.mockReturnValue({mtime:new Date('2026-01-01')});});
test('one industry code derives a consistent three-level hierarchy',()=>{
  const result=validateOverrides({version:1,overrides:{MSFT:{industry_code:'451030',reason:'Reviewed'}}});
  expect(result.errors).toEqual([]);expect(result.overrides.get('MSFT')).toMatchObject({sector_code:'45',sector_name:'Information Technology',industry_group_code:'4510',industry_group_name:'Software & Services',industry_name:'Software'});
});
test('invalid codes, symbols and inconsistent parent fields are rejected per entry',()=>{
  const result=validateOverrides({version:1,overrides:{MSFT:{industry_code:'451030',sector_code:'40'},NVDA:{industry_code:'not-a-code'},'bad symbol':{industry_code:'451030'},GOOD:{industry_code:'451030'}}});
  expect(result.errors).toHaveLength(3);expect([...result.overrides.keys()]).toEqual(['GOOD']);
});
test('override takes precedence, preserves the provider and only matches exact symbols',()=>{
  fs.readFileSync.mockReturnValue(JSON.stringify({version:1,overrides:{MSFT:{industry_code:'451030'}}}));
  const result=applyOverrides(['MSFT','MSFT.L'],new Map([['MSFT',provider]]));
  expect(result.get('MSFT')).toMatchObject({source:'Manual override',status:'manual_override',industry_code:'451030',provider_classification:provider});
  expect(result.has('MSFT.L')).toBe(false);expect(provider.industry_name).toBe('Provider industry');
});
test('removing an entry restores provider values on the next read',()=>{
  fs.readFileSync.mockReturnValue(JSON.stringify({version:1,overrides:{MSFT:{industry_code:'451030'}}}));
  expect(applyOverrides(['MSFT'],new Map([['MSFT',provider]])).get('MSFT').source).toBe('Manual override');
  fs.readFileSync.mockReturnValue(JSON.stringify({version:1,overrides:{}}));
  expect(applyOverrides(['MSFT'],new Map([['MSFT',provider]])).get('MSFT')).toEqual(provider);
});
test('malformed file falls back to provider and surfaces a warning',()=>{
  fs.readFileSync.mockReturnValue('{broken');
  expect(applyOverrides(['MSFT'],new Map([['MSFT',provider]])).get('MSFT')).toMatchObject({source:'FinanceDatabase',industry_name:'Provider industry',override_warning:expect.stringContaining('JSON format')});
});
test('manual classification can cover a symbol missing from the provider',()=>{
  fs.readFileSync.mockReturnValue(JSON.stringify({version:1,overrides:{'DEMO.L':{industry_code:'451030'}}}));
  expect(applyOverrides(['DEMO.L'],new Map()).get('DEMO.L')).toMatchObject({industry_code:'451030',provider_classification:null});
});
