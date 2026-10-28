const {definitionForManagement}=require('../../src/services/planningManagementRows');
test.each(['entry','exit'])('explicit positions preserve appended %s order despite JSONB key order',action=>{
 const field=action==='entry'?'entries':'exits',first='f'.repeat(32),last='0'.repeat(32),plan={definition:{entries:[{key:'base-entry',label:'Original entry'}],exits:[{key:'base-exit',label:'Original exit'}]},management:{[action]:{[last]:{position:2,stage:{label:'New row'},price:120,units:null},[first]:{position:1,stage:{label:'Earlier row'},price:100,units:null}}}};
 const before=JSON.stringify(plan),result=definitionForManagement(plan);
 expect(result[field].map(r=>r.label)).toEqual([action==='entry'?'Original entry':'Original exit','Earlier row','New row']);
 expect(JSON.stringify(plan)).toBe(before);expect(result[field].slice(1).every(r=>!Object.hasOwn(r,'position'))).toBe(true);
});
test('legacy management rows retain their current order until explicit positions are saved',()=>{
 const p={definition:{entries:[{key:'original'}],exits:[]},management:{entry:{older:{stage:{label:'Legacy first'}},newer:{stage:{label:'Legacy second'}}}}};
 expect(definitionForManagement(p).entries.map(r=>r.key)).toEqual(['original','older','newer']);
});

test('an older client cannot silently erase existing row positions',()=>{
 const {preservePositions}=require('../../src/services/planningManagementRows');
 const previous={entry:{one:{position:3},two:{position:4}},exit:{target:{position:1}}},next={entry:{one:{price:100},two:{position:2}},exit:{target:{price:110}}};
 expect(preservePositions(previous,next)).toEqual({entry:{one:{price:100,position:3},two:{position:2}},exit:{target:{price:110,position:1}}});
 expect(previous.entry.two.position).toBe(4);
});
