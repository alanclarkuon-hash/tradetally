const merger=require('../../src/services/verifiedMergerPriceBasis');
const provider=require('../../src/services/stockAnalysisHistory');
const dates=['2026-07-20','2026-07-21','2026-07-22'];
const data=()=>({symbol:'AVB',ticker:'AVB',name:'AvalonBay Communities, Inc.',exchange:'NYSE',currency:'USD',source:'stockanalysis:spg',unadjustedAfter:'1900-01-01',prices:[{date:'2021-11-03',close:10},...dates.map((date,i)=>({date,close:100+i}))]});
const cached=()=>({currency:'USD',splits:[{date:'2026-08-17',ratio:2.793}],prices:dates.map((date,i)=>({date,close:(100+i)*2.793}))});

test('documented conversion plus independent native closes recovers old predecessor prices in native units',()=>{
 const d=data(),c=cached(),proof=merger.proof(d,c);
 expect(proof.nativeAnchorCount).toBe(3);expect(merger.covers('AVB','2021-11-03',proof)).toBe(true);
 expect(provider.verifiedRows(d,'2021-11-03','2021-11-03',c)).toEqual([{date:'2021-11-03',close:27.93}]);
});
test.each(['unknown-issuer','unknown-venue','wrong-ratio','too-few-anchors','conflicting-anchor','real-stock-split','no-provider-proof'])('does not guess predecessor price basis: %s',type=>{
 const d=data(),c=cached();
 if(type==='unknown-issuer')d.name='Another issuer';
 if(type==='unknown-venue')d.exchange='OTC';
 if(type==='wrong-ratio')c.splits[0].ratio=2;
 if(type==='too-few-anchors')c.prices.pop();
 if(type==='conflicting-anchor')c.prices[0].close*=2;
 if(type==='real-stock-split')c.splits.push({date:'2022-01-01',ratio:2});
 if(type==='no-provider-proof')delete d.unadjustedAfter;
 expect(merger.proof(d,c)).toBeNull();
});
test('a merger cannot authorize predecessor prices after conversion or beyond independently observed history',()=>{
 const proof=merger.proof(data(),cached());
 expect(merger.covers('AVB','2026-08-17',proof)).toBe(false);
 expect(merger.covers('AVB','2020-01-01',proof)).toBe(false);
 expect(merger.covers('VMRK','2021-11-03',proof)).toBe(false);
 const d=data();d.prices.push({date:'2026-08-17',close:999});
 expect(provider.verifiedRows(d,'2026-08-17','2026-08-17',cached())).toEqual([]);
});
test('missing native evidence cannot be replaced by a corporate-action reference alone',()=>{
 const d=data();expect(merger.proof(d,{...cached(),prices:[]})).toBeNull();
});
test('forged, mismatched or incomplete saved proofs cannot bypass a listing boundary',()=>{
 const p=merger.proof(data(),cached());
 for(const patch of [{source:'unknown'},{ratio:1},{provider:'unverified'},{nativeAnchorCount:1},{to:'2027-01-01'}])expect(merger.covers('AVB','2021-11-03',{...p,...patch})).toBe(false);
});
