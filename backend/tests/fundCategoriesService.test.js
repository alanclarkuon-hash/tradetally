jest.mock('../src/utils/cache',()=>({get:jest.fn(),set:jest.fn()}));
jest.mock('axios',()=>({get:jest.fn()}));
const {parseLabels,getCategories}=require('../src/services/fundCategoriesService');
const page=symbol=>`<link rel="canonical" href="https://finance.yahoo.com/quote/${symbol}/"><div><p>Technology</p><h3>Fund Category</h3></div><div><p>Example Funds</p><h3>Fund Family</h3></div>`;
test('preserves provider category and family without inferring labels',()=>{
  expect(parseLabels(page('EXAMPLE.L'),'EXAMPLE.L')).toEqual({primaryCategory:'Technology',categories:['Fund Category: Technology','Fund Family: Example Funds'],source:'Yahoo Finance'});
});
test('a different exchange listing cannot supply categories',()=>{
  expect(parseLabels(page('EXAMPLE'),'EXAMPLE.L')).toBeNull();
  expect(parseLabels('<div><p>Technology</p><h3>Fund Category</h3></div>','EXAMPLE.L')).toBeNull();
});
test('missing metadata is cached as unavailable',async()=>{
  require('axios').get.mockRejectedValue(Error('404'));
  const result=await getCategories('EXAMPLE.L');
  expect(result.primaryCategory).toBeNull();expect(result.categories).toEqual([]);
  expect(require('../src/utils/cache').set).toHaveBeenCalledWith('yahoo_fund_labels','EXAMPLE.L',result,86400000);
});
