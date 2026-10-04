jest.mock('axios',()=>({get:jest.fn()}));
jest.mock('fs/promises',()=>({readFile:jest.fn().mockResolvedValue('{}'),mkdir:jest.fn(),writeFile:jest.fn(),rename:jest.fn()}));
const axios=require('axios');
const {getCategories,primaryCategory,cleanCategories}=require('../src/services/cryptoCategoriesService');
test('keeps all labels but chooses one theme for the heatmap',()=>{
  const categories=cleanCategories(['Layer 1 (L1)','Artificial Intelligence (AI)','Layer 1 (L1)',null]);
  expect(categories).toHaveLength(2);expect(primaryCategory(categories)).toBe('Artificial Intelligence (AI)');
  expect(primaryCategory(['Example Ecosystem','Example Portfolio'])).toBeNull();
});
test('uses exact CoinGecko IDs and caches category metadata',async()=>{
  axios.get.mockResolvedValue({data:{id:'near',categories:['Artificial Intelligence (AI)','Layer 1 (L1)']}});
  const result=await getCategories('NEAR');
  expect(result.categories).toContain('Layer 1 (L1)');expect(result.primaryCategory).toBe('Artificial Intelligence (AI)');
  await getCategories('NEAR');expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][0]).toBe('https://api.coingecko.com/api/v3/coins/near');
});
