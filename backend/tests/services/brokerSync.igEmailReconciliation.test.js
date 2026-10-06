const {reconciled}=require('../../src/services/brokerSync/igEmailReconciliation');
const event={time:'2026-10-05T04:00:00.000Z',cash:1,type:'interest',description:'Cash interest'};
const point={date:'2026-10-05',cash:11,activitySupported:true,records:[event]};
test('only a complete matching native ledger clears a pending email valuation',()=>{
 expect(reconciled(point,[{time:'2026-10-01T00:00:00.000Z',cash:10},event])).toBe(true);
 expect(reconciled(point,[event])).toBe(false);
 expect(reconciled({...point,activitySupported:false},[{time:'2026-10-01T00:00:00.000Z',cash:10},event])).toBe(false);
});
test('equal totals with mismatched event timing cannot silently clear a review',()=>{
 expect(reconciled(point,[{time:'2026-10-01T00:00:00.000Z',cash:10},{...event,time:'2026-10-05T05:00:00.000Z'}])).toBe(false);
});
