const {ledger,sourceFills}=require('../../src/services/planningLedger');
function fixture(){
 const p={definition:{symbol:'TEST',instrument:'stock',direction:'long',currency:'USD',accountId:'account',stopPrice:80,entries:[{key:'old'},{key:'level'}],exits:[{key:'take'}]},management:{entry:{},exit:{take:{entryMatches:[{entryKey:'level',quantity:2}]}}},baseline:{riskBudget:100,currency:'USD'}};
 const trades=[['old',100,'2026-01-01', 'buy',2],['level',90,'2026-01-02','buy',4],['sale',110,'2026-01-03','sell',2]].map(([id,price,time,action,quantity])=>({id,account_identifier:'synthetic',side:'long',symbol:'TEST',instrument_type:'stock',original_currency:'USD',commission:0,fees:0,executions:[{id,action,quantity,price,datetime:time+'T10:00:00Z',commission:0,fees:0}]}));
 const allocations=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:t.id==='sale'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});
 return {p,trades,allocations};
}
test('a matched grid exit uses its entry row and adding an earlier unsold row leaves realised unchanged',()=>{
 const {p,trades,allocations}=fixture();const before=ledger(p,allocations.filter(a=>a.stage_key!=='old'),trades),after=ledger(p,allocations,trades);
 expect(before.realisedProfit).toBe(40);expect(after.realisedProfit).toBe(40);expect(after.positionValue).toBe(380);expect(after.openLots.filter(l=>l.stageKey==='old').reduce((q,l)=>q+l.q,0)).toBe(2);
});
test('several eligible entry rows require a match rather than silently choosing FIFO',()=>{const {p,trades,allocations}=fixture();delete p.management.exit.take.entryMatches;const r=ledger(p,allocations,trades);expect(r.matchingUnresolved).toBeGreaterThan(0);expect(r.realisedProfit).toBeNull();expect(r.openLots).toBeNull();expect(r.economicallyClosed).toBe(false)});
test('partial exits can match quantities from multiple rows',()=>{const {p,trades,allocations}=fixture();p.management.exit.take.entryMatches=[{entryKey:'old',quantity:1},{entryKey:'level',quantity:1}];const r=ledger(p,allocations,trades);expect(r.realisedProfit).toBe(30);expect(r.positionValue).toBe(370)});
test.each([[{entryKey:'missing',quantity:2}],[{entryKey:'level',quantity:3}],[{entryKey:'level',quantity:1}]])('invalid or incomplete row matches expose no guessed realised profit: %j',matches=>{const {p,trades,allocations}=fixture();p.management.exit.take.entryMatches=matches;const r=ledger(p,allocations,trades);expect(r.matchingUnresolved).toBeGreaterThan(0);expect(r.realisedProfit).toBeNull()});
test('entry fees are attributed only to the matched sold quantity',()=>{const {p,trades}=fixture();trades[1].commission=4;trades[1].executions[0].commission=4;trades[2].commission=1;trades[2].executions[0].commission=1;const a=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:t.id==='sale'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});expect(ledger(p,a,trades).realisedProfit).toBe(37)});

test('an explicitly matched later grid level works for shorts too',()=>{const {p,trades}=fixture();p.definition.direction='short';trades.forEach(t=>{t.side='short';t.executions.forEach(e=>e.action=e.action==='buy'?'sell':'buy')});const a=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:t.id==='sale'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});expect(ledger(p,a,trades).realisedProfit).toBe(-40)});
test('entry-row matching cannot cross accounts',()=>{const {p,trades,allocations}=fixture();p.definition.entries[1].accountId='another-account';const r=ledger(p,allocations,trades);expect(r.realisedProfit).toBeNull();expect(r.matchingUnresolved).toBeGreaterThan(0)});
test('an entry after its exit cannot supply a match',()=>{const {p,trades}=fixture();trades[1].executions[0].datetime='2026-01-04T10:00:00Z';const a=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:t.id==='sale'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});expect(ledger(p,a,trades).realisedProfit).toBeNull()});
test('a single eligible entry row can be remembered before another unsold row is linked',()=>{const {p,trades,allocations}=fixture();delete p.management.exit.take.entryMatches;const first=allocations.filter(a=>a.stage_key!=='old');const r=ledger(p,first,trades);expect(r.realisedProfit).toBe(40);p.management=require('../../src/services/planningEntryMatches').remember(p,r);expect(ledger(p,allocations,trades).realisedProfit).toBe(40)});
test('multiple fills within a matched entry row share weighted cost without allocation-id dependence',()=>{const {p,trades,allocations}=fixture();allocations[0].stage_key='level';const r=ledger(p,allocations,trades),reversed=ledger(p,allocations.map(a=>({...a,id:a.id+'-new'})).reverse(),trades);expect(r.realisedProfit).toBeCloseTo(110*2-(100*2+90*4)*2/6);expect(reversed.realisedProfit).toBeCloseTo(r.realisedProfit);expect(r.positionValue).toBeCloseTo((100*2+90*4)*4/6)});
test('two exits cannot consume the same matched units twice',()=>{const {p,trades,allocations}=fixture();p.definition.exits.push({key:'second'});p.management.exit.second={entryMatches:[{entryKey:'level',quantity:3}]};const t={...trades[2],id:'sale2',executions:[{...trades[2].executions[0],id:'sale2',quantity:3,datetime:'2026-01-04T10:00:00Z'}]};const f=sourceFills(t)[0];const r=ledger(p,[...allocations,{id:'sale2',trade_id:t.id,source_key:f.key,stage_key:'second',action:'exit',quantity:3,source_snapshot:f}],[...trades,t]);expect(r.matchingUnresolved).toBeGreaterThan(0);expect(r.realisedProfit).toBeNull()});
test('broker position identities resolve the entry row without inferring FIFO',()=>{const {p,trades}=fixture();delete p.management.exit.take.entryMatches;trades.forEach((t,i)=>{t.broker='etoro';t.executions[0].etoro_position_id=i===0?'old-position':'sold-position'});const a=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:t.id==='sale'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});const r=ledger(p,a,trades);expect(r.matchingUnresolved).toBe(0);expect(r.realisedProfit).toBe(40);expect(r.entryMatching[0].matches).toEqual([{entryKey:'level',quantity:2}])});
test('one exit row can close multiple broker positions from selected entry rows',()=>{const {p,trades}=fixture();p.management.exit.take.entryMatches=[{entryKey:'old',quantity:1},{entryKey:'level',quantity:1}];trades.forEach((t,i)=>{t.broker='etoro';t.executions[0].etoro_position_id=i===1?'position-b':'position-a'});trades[2].executions[0].quantity=1;const t={...trades[2],id:'second-sale',executions:[{...trades[2].executions[0],id:'second-sale',etoro_position_id:'position-b'}]};trades.push(t);const a=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:f.action==='exit'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});const r=ledger(p,a,trades);expect(r.matchingUnresolved).toBe(0);expect(r.realisedProfit).toBe(30)});

function precisionFixture(entryQuantity,exitQuantity,matchedQuantity=exitQuantity){
 const {p,trades}=fixture();trades[1].executions[0].quantity=entryQuantity;trades[2].executions[0].quantity=exitQuantity;
 p.management.exit.take.entryMatches=[{entryKey:'level',quantity:matchedQuantity}];
 const allocations=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:t.id==='sale'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});
 return {p,trades,allocations};
}
test.each([17.00000002,17.00000001])('broker-precision boundary matches do not fail due to binary subtraction (%s)',matched=>{
 const {p,trades,allocations}=precisionFixture(17.00000001,17.00000002,matched),before=JSON.stringify({p,trades,allocations});
 const r=ledger(p,allocations,trades);
 expect(r.entryMatching.find(row=>row.exitKey==='take').status).toBe('matched');expect(r.matchingUnresolved).toBe(0);expect(r.overExit).toBe(false);
 const used=r.records.find(a=>a.action==='exit').matchedEntries.reduce((q,a)=>q+a.quantity,0);
 expect(used).toBe(17.00000001);expect(r.realisedProfit).toBeCloseTo(17.00000001*20,10);expect(r.accountRealisedProfit).not.toBeNull();
 expect(r.openLots.find(l=>l.stageKey==='old').q).toBe(2);expect(JSON.stringify({p,trades,allocations})).toBe(before);
});
test('a real shortage beyond the matching allowance remains rejected',()=>{
 const {p,trades,allocations}=precisionFixture(17.00000001,17.00000004);const r=ledger(p,allocations,trades);
 expect(r.entryMatching.find(row=>row.exitKey==='take').status).toBe('needs_match');expect(r.realisedProfit).toBeNull();
});
test('a tolerance-sized final residual is closed consistently without an invented entry quantity',()=>{
 const {p,trades,allocations}=precisionFixture(17.00000001,17.00000002);const r=ledger(p,allocations.filter(a=>a.stage_key!=='old'),trades);
 expect(r.overExit).toBe(false);expect(r.matchingUnresolved).toBe(0);expect(r.economicallyClosed).toBe(true);expect(r.openLots).toEqual([]);
 expect(r.records.find(a=>a.action==='exit').matchedEntries[0].quantity).toBe(17.00000001);
});

test('a precision-boundary exit split over two rows never exceeds either real entry capacity',()=>{
 const {p,trades}=precisionFixture(8.00000001,17.00000002);trades[0].executions[0].quantity=9;
 p.management.exit.take.entryMatches=[{entryKey:'old',quantity:9},{entryKey:'level',quantity:8.00000001}];
 const a=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:t.id==='sale'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});
 const r=ledger(p,a,trades);expect(r.matchingUnresolved).toBe(0);expect(r.realisedProfit).toBeCloseTo(250.0000002,8);
 const matches=r.records.find(x=>x.action==='exit').matchedEntries;
 expect(matches.find(m=>m.entryKey==='old').quantity).toBeLessThanOrEqual(9);expect(matches.find(m=>m.entryKey==='level').quantity).toBeLessThanOrEqual(8.00000001);
});
test('a genuinely linked minimum-sized entry can be consumed but an empty queue cannot create units',()=>{
 const {p,trades,allocations}=precisionFixture(1e-8,1e-8);const r=ledger(p,allocations,trades);expect(r.matchingUnresolved).toBe(0);expect(r.records.find(a=>a.action==='exit').matchedEntries[0].quantity).toBe(1e-8);
 expect(require('../../src/services/planningEntryMatches').consume([],{status:'matched',matches:[{entryKey:'level',quantity:1e-8}]},{quantity:1e-8})).toBeNull();
});


test('availability subtracts another exit match and restores the current exit own units for editing',()=>{
 const {p,trades,allocations}=fixture();
 const t={...trades[2],id:'later-sale',executions:[{...trades[2].executions[0],id:'later-sale',quantity:1,datetime:'2026-01-04T10:00:00Z'}]};
 const f=sourceFills(t)[0];p.definition.exits.push({key:'later'});
 const all=[...allocations,{id:t.id,trade_id:t.id,source_key:f.key,stage_key:'later',action:'exit',quantity:1,source_snapshot:f}];
 const r=ledger(p,all,[...trades,t]);const option=r.entryMatching.find(x=>x.exitKey==='later').options.find(o=>o.entryKey==='level');
 expect(option).toMatchObject({quantity:2,totalQuantity:4,assignedQuantity:2});
 p.management.exit.later={entryMatches:[{entryKey:'level',quantity:1}]};
 const editing=ledger(p,all,[...trades,t]);
 expect(editing.entryMatching.find(x=>x.exitKey==='take').options.find(o=>o.entryKey==='level').quantity).toBe(3);
 expect(editing.entryMatching.find(x=>x.exitKey==='later').options.find(o=>o.entryKey==='level').quantity).toBe(2);
 expect(editing.realisedProfit).toBe(60);
});

test('availability accounts for later saved exits without silently choosing FIFO for the current exit',()=>{
 const {p,trades,allocations}=fixture();delete p.management.exit.take.entryMatches;
 const t={...trades[2],id:'reserved-later',executions:[{...trades[2].executions[0],id:'reserved-later',quantity:4,datetime:'2026-01-04T10:00:00Z'}]};
 const f=sourceFills(t)[0];p.definition.exits.push({key:'later'});p.management.exit.later={entryMatches:[{entryKey:'level',quantity:4}]};
 const r=ledger(p,[...allocations,{id:t.id,trade_id:t.id,source_key:f.key,stage_key:'later',action:'exit',quantity:4,source_snapshot:f}],[...trades,t]);
 expect(r.entryMatching.find(x=>x.exitKey==='take').options.find(o=>o.entryKey==='level')).toMatchObject({quantity:0,totalQuantity:4,assignedQuantity:4});
 expect(r.entryMatching.find(x=>x.exitKey==='take').status).toBe('needs_match');
});


test('availability deducts only consumed source fills that were eligible at this exit time',()=>{
 const {p,trades,allocations}=fixture();delete p.management.exit.take.entryMatches;
 const lateEntry={...trades[1],id:'late-entry',executions:[{...trades[1].executions[0],id:'late-entry',datetime:'2026-01-05T10:00:00Z'}]};
 const laterExit={...trades[2],id:'later-exit',executions:[{...trades[2].executions[0],id:'later-exit',quantity:4,datetime:'2026-01-06T10:00:00Z'}]};
 p.definition.exits.push({key:'later'});p.management.exit.later={entryMatches:[{entryKey:'level',quantity:4}]};
 const extra=[lateEntry,laterExit].map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:f.action==='entry'?'level':'later',action:f.action,quantity:f.quantity,source_snapshot:f}});
 const r=ledger(p,[...allocations,...extra],[...trades,lateEntry,laterExit]);
 expect(r.entryMatching.find(x=>x.exitKey==='take').options.find(o=>o.entryKey==='level')).toMatchObject({quantity:2,totalQuantity:4,assignedQuantity:2});
});
