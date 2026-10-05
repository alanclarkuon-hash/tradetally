jest.mock('../src/services/coinGeckoClient',()=>({get:jest.fn()}));
jest.mock('fs/promises',()=>({readFile:jest.fn().mockResolvedValue('{}'),mkdir:jest.fn(),writeFile:jest.fn(),rename:jest.fn()}));
const axios=require('../src/services/coinGeckoClient');
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
  expect(axios.get.mock.calls[0][0]).toBe('/coins/near');
});
test('retains saved categories when an expired provider lookup returns empty labels',async()=>{
 jest.resetModules();
 require('fs/promises').readFile.mockResolvedValue(JSON.stringify({near:{categories:['Artificial Intelligence (AI)'],asOf:'2020-01-01T00:00:00Z'}}));
 axios.get.mockResolvedValue({data:{id:'near',categories:[]}});
 const service=require('../src/services/cryptoCategoriesService');
 const result=await service.getCategories('NEAR');
 expect(result.primaryCategory).toBe('Artificial Intelligence (AI)');
 expect(result.asOf).toBe('2020-01-01T00:00:00Z');
 expect(result.stale).toBe(true);
});

test('fetches and persists a CoinGecko logo without erasing saved categories',async()=>{
 jest.resetModules();
 require('fs/promises').readFile.mockResolvedValue(JSON.stringify({sui:{categories:['Layer 1 (L1)'],asOf:'2020-01-01T00:00:00Z'}}));
 require('../src/services/coinGeckoClient').get.mockResolvedValue({data:{id:'sui',categories:[],image:{small:'https://coin-images.coingecko.com/coins/images/26375/small/sui.png'}}});
 const service=require('../src/services/cryptoCategoriesService');
 const result=await service.getCategories('SUI',{requireLogo:true});
 expect(result.logo).toContain('coin-images.coingecko.com');
 expect(result.categories).toEqual(['Layer 1 (L1)']);
 expect(await service.getLogo('SUI')).toBe(result.logo);
 expect(service.cleanLogo('https://stock.example/sui.png')).toBeNull();
});
