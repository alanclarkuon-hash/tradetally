jest.mock('../src/services/schedulers/IntervalScheduler',()=>class {});
jest.mock('../src/utils/symbolCategories',()=>({categorizeNewSymbols:jest.fn()}));
jest.mock('../src/services/assetClassificationService',()=>({enrichExistingStocks:jest.fn()}));
const scheduler=require('../src/services/symbolCategoryScheduler');
const native=require('../src/utils/symbolCategories');
const reference=require('../src/services/assetClassificationService');
test('reference enrichment failure does not prevent native provider categorisation',async()=>{
  reference.enrichExistingStocks.mockRejectedValue(Error('dataset unavailable'));
  native.categorizeNewSymbols.mockResolvedValue({total:1,processed:1});
  await expect(scheduler.execute()).resolves.toEqual({total:1,processed:1});
  expect(native.categorizeNewSymbols).toHaveBeenCalledTimes(1);
});
