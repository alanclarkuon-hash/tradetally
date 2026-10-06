const {merge}=require('../../src/services/brokerSync/igEmailCash');
const event={reference:'email:CS123',time:'2026-10-05T04:00:00.000Z',date:'2026-10-05',cash:1,amount:1,type:'interest',description:'Cash interest',reportedBalance:10,source:'ig_email'};
test('reprocessing statement cash cannot duplicate income',()=>{expect(merge([], [event,event]).records).toHaveLength(1);});
test('a later CSV replaces email-only identity without duplicating its cash',()=>{
 const csv={...event,reference:'CSV123'};const result=merge([csv],[event]);expect(result.records).toHaveLength(1);expect(result.aliases.get(event.reference)).toBe('CSV123');
});
test('identical reference with corrected financial evidence requires review',()=>{expect(()=>merge([],[event,{...event,cash:2}])).toThrow('Conflicting');});
test('ambiguous export counterpart requires review',()=>{expect(()=>merge([{...event,reference:'CSV1'},{...event,reference:'CSV2'}],[event])).toThrow('Ambiguous');});
test('same amount on a different date stays separate',()=>{expect(merge([{...event,reference:'CSV1',time:'2026-10-04T04:00:00.000Z'}],[event]).records).toHaveLength(2);});
