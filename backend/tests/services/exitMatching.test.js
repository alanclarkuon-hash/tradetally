jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/analyticsCache',()=>({invalidate:jest.fn()}));
const {preserveCorrections,compatible,validatePosition,version}=require('../../src/services/exitMatching');
const {planSnapshot,validateCoverage}=require('../../src/services/brokerSync/trading212Reconcile');
const buy={action:'buy',type:'entry',order_id:'b',price:100,quantity:2,datetime:'2026-01-01T12:00:00Z',fees:1};
const sell={action:'sell',type:'exit',order_id:'s',price:110,quantity:2,datetime:'2026-01-03T12:00:00Z',fees:2};
const row={id:'old',symbol:'TEST',side:'long',executions:[buy,sell],broker:'trading212',instrument_type:'stock',account_identifier:'synthetic',broker_connection_id:'connection',original_currency:'USD'};
const desired={...row,executionData:[buy,sell],executions:undefined};
it('preserves detached exit and original trade ID across the next snapshot',()=>{
 const corrected={...row,matching_baseline:[buy,sell],executions:[buy],exit_time:null};
 const plans=preserveCorrections([desired],[corrected]);
 expect(plans[0].executionData).toEqual([buy]);
 expect(planSnapshot(plans,[corrected])[0].old.id).toBe('old');
 validateCoverage([{fill:{id:'b',quantity:2}},{fill:{id:'s',quantity:2}}],[...plans,{executions:[sell]}]);
});
it('preserves an exit moved to another trade with no loss or duplication',()=>{
 const otherBuy={...buy,order_id:'b2',price:105};
 const source={...row,matching_baseline:[buy,sell],executions:[buy]};
 const target={...row,id:'target',matching_baseline:[otherBuy],executions:[otherBuy,sell]};
 const plans=preserveCorrections([desired,{...desired,executionData:[otherBuy]}],[source,target]);
 expect(planSnapshot(plans,[source,target]).map(p=>p.old.id)).toEqual(['old','target']);
 validateCoverage([{fill:{id:'b',quantity:2}},{fill:{id:'b2',quantity:2}},{fill:{id:'s',quantity:2}}],plans);
});
it('rejects changed broker price or quantity instead of overwriting the correction',()=>{
 const corrected={...row,matching_baseline:[buy,sell],executions:[buy]};
 expect(()=>preserveCorrections([{...desired,executionData:[buy,{...sell,price:120}]}],[corrected])).toThrow('evidence changed');
});
it('keeps default matching unchanged when there is no correction',()=>expect(preserveCorrections([desired],[row])).toEqual([desired]));
it('rejects an exit before entry or larger than the position',()=>{
 expect(()=>validatePosition(row,[buy,{...sell,quantity:3}])).toThrow('exceeds');
 expect(()=>validatePosition(row,[buy,{...sell,datetime:'2025-12-01'}])).toThrow('exceeds');
 expect(validatePosition(row,[buy,{...sell,quantity:1}])).toBe(1);
});
it.each(['symbol','side','broker','account_identifier','broker_connection_id','instrument_type','original_currency'])('scopes compatibility by %s',key=>expect(compatible(row,{...row,[key]:'different'})).toBe(false));
it('versions change when execution evidence changes',()=>expect(version(row)).not.toBe(version({...row,executions:[buy]})));
