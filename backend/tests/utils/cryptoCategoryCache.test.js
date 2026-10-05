const {mergeCategoryCache}=require('../../src/utils/cryptoCategoryCache');
const saved={near:{categories:['Artificial Intelligence (AI)'],asOf:'2026-10-03T12:00:00Z'}};
test('fills missing metadata without replacing newer labels or erasing known categories',()=>{
 expect(mergeCategoryCache({},saved)).toEqual(saved);
 expect(mergeCategoryCache(saved,{near:{categories:[],asOf:'2026-10-04T12:00:00Z'}})).toEqual(saved);
 expect(mergeCategoryCache(saved,{near:{categories:['Layer 1 (L1)'],asOf:'2026-10-02T12:00:00Z'}})).toEqual(saved);
 expect(mergeCategoryCache(saved,saved)).toEqual(saved);
});
test('accepts discovered coin IDs and rejects unsafe IDs, invalid timestamps and invalid labels',()=>{
 expect(mergeCategoryCache({},{'new-coin':saved.near})['new-coin']).toEqual(saved.near);
 for(const incoming of [{'../fake':saved.near},{near:{...saved.near,asOf:'bad'}},{near:{...saved.near,categories:[null]}}])expect(()=>mergeCategoryCache({},incoming)).toThrow();
});
