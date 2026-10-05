jest.mock('../../src/services/cryptoCategoriesService', () => ({getCachedCategories: jest.fn()}));
jest.mock('../../src/services/categoryOverrides', () => ({applyCategoryOverride: jest.fn((s,k,m)=>m)}));
const crypto = require('../../src/services/cryptoCategoriesService');
const overrides = require('../../src/services/categoryOverrides');
const {getSectorCategory} = require('../../src/utils/sectorCategory');

beforeEach(()=>jest.clearAllMocks());
test.each(['SUI','LINK','FET'])('crypto %s ignores colliding company industry', async symbol=>{
  crypto.getCachedCategories.mockResolvedValue({primaryCategory:'Layer 1 (L1)'});
  expect(await getSectorCategory({symbol,instrument_type:'crypto'}, {finnhub_industry:'REIT'}))
    .toEqual({finnhub_industry:'Crypto · Layer 1 (L1)'});
});
test('same ticker stock keeps its equity industry', async()=>{
  const company={finnhub_industry:'REIT'};
  expect(await getSectorCategory({symbol:'SUI',instrument_type:'company'},company)).toBe(company);
  expect(crypto.getCachedCategories).not.toHaveBeenCalled();
});
test('missing crypto labels never fall back to a company',async()=>{
  crypto.getCachedCategories.mockResolvedValue(null);
  expect(await getSectorCategory({symbol:'UNKNOWN',instrument_type:'crypto'}, {finnhub_industry:'REIT'}))
    .toEqual({finnhub_industry:'Crypto · Unclassified'});
});
test('manual crypto override takes priority',async()=>{
  crypto.getCachedCategories.mockResolvedValue({primaryCategory:'Layer 1 (L1)'});
  overrides.applyCategoryOverride.mockReturnValueOnce({primaryCategory:'Artificial Intelligence (AI)'});
  expect(await getSectorCategory({symbol:'NEAR',instrument_type:'crypto'},null))
    .toEqual({finnhub_industry:'Crypto · Artificial Intelligence (AI)'});
});
