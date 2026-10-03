jest.mock('fs',()=>({readFileSync:jest.fn(),statSync:jest.fn()}));
const fs=require('fs');
const {applyCategoryOverride,validateCategoryOverrides}=require('../src/services/categoryOverrides');
const entry={category:'Quantum Computing',reason:'Issuer mandate',source_url:'https://example.com/fund'};
const provider={primaryCategory:'Technology',categories:['Fund Category: Technology'],source:'Yahoo Finance'};
beforeEach(()=>{fs.statSync.mockReturnValue({mtime:new Date('2026-01-01')});});
test('rejects unsafe links and unknown types while retaining valid entries',()=>{
  const result=validateCategoryOverrides({version:1,overrides:{fund:{'EXAMPLE.L':entry,BAD:{...entry,source_url:'javascript:alert(1)'}},stock:{DEMO:entry}}});
  expect(result.errors).toHaveLength(2);expect([...result.entries.keys()]).toEqual(['fund:EXAMPLE.L']);
});
test('category correction preserves provider and separates asset type and exchange',()=>{
  fs.readFileSync.mockReturnValue(JSON.stringify({version:1,overrides:{fund:{'EXAMPLE.L':entry}}}));
  expect(applyCategoryOverride('EXAMPLE.L','fund',provider)).toMatchObject({primaryCategory:'Quantum Computing',source:'Manual override',provider_classification:provider});
  expect(applyCategoryOverride('EXAMPLE.L','crypto',provider)).toBe(provider);
  expect(applyCategoryOverride('EXAMPLE','fund',provider)).toBe(provider);
  expect(provider.primaryCategory).toBe('Technology');
});
test('missing labels can be filled without inventing provider records',()=>{
  fs.readFileSync.mockReturnValue(JSON.stringify({version:1,overrides:{fund:{'EXAMPLE.L':entry}}}));
  expect(applyCategoryOverride('EXAMPLE.L','fund',null)).toMatchObject({primaryCategory:'Quantum Computing',provider_classification:null});
});
test('removal immediately restores provider and malformed JSON falls back visibly',()=>{
  fs.readFileSync.mockReturnValue(JSON.stringify({version:1,overrides:{}}));
  expect(applyCategoryOverride('EXAMPLE.L','fund',provider)).toBe(provider);
  fs.readFileSync.mockReturnValue('{broken');
  expect(applyCategoryOverride('EXAMPLE.L','fund',provider)).toMatchObject({primaryCategory:'Technology',override_warning:expect.any(String)});
});
