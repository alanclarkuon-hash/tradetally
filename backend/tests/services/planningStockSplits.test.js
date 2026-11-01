const {ledger,sourceFills}=require('../../src/services/planningLedger');
const {remember}=require('../../src/services/planningEntryMatches');
function fixture(events=[{date:'2026-02-01',ratio:2}]){
 const p={definition:{symbol:'SYN',instrument:'stock',direction:'long',currency:'USD',accountId:'account',stopPrice:40,entries:[{key:'entry'}],exits:[{key:'before'},{key:'after'}]},baseline:{riskBudget:100,currency:'USD'}};
 const t={id:'trade',symbol:'SYN',broker:'trading212',side:'long',instrument_type:'stock',original_currency:'USD',executions:[
 {id:'buy',action:'buy',quantity:10,price:100,datetime:'2026-01-01T10:00:00Z',commission:2},
 {id:'pre',action:'sell',quantity:4,price:120,datetime:'2026-01-20T10:00:00Z',commission:1},
 {id:'post',action:'sell',quantity:6,price:70,datetime:'2026-02-03T10:00:00Z',commission:3}]};
 const trades=[t];trades.planningSplits={SYN:{currency:'USD',splits:events}};
 const allocations=sourceFills(t).map((f,i)=>({id:String(i),trade_id:t.id,stage_key:['entry','before','after'][i],action:f.action,quantity:f.quantity,source_key:f.key,source_snapshot:f}));
 return {p,t,trades,allocations};
}
test('normalizes pre/post split units and prices while preserving total cost, fees and source evidence',()=>{
 const {p,trades,allocations}=fixture(),original=JSON.stringify({p,trades,allocations});const r=ledger(p,allocations,trades);
 expect(r.overExit).toBe(false);expect(r.matchingUnresolved).toBe(0);expect(r.entered).toBe(20);expect(r.exited).toBe(14);expect(r.openQuantity).toBe(6);expect(r.entryCost).toBe(1000);expect(r.averagePrice).toBe(50);expect(r.positionValue).toBe(300);
 expect(r.records[1].realisedProfit).toBeCloseTo(78.2);expect(r.records[2].realisedProfit).toBeCloseTo(116.4);expect(r.realisedProfit).toBeCloseTo(194.6);
 expect(r.records[0]).toMatchObject({quantity:20,sourceQuantity:10,splitFactor:2,fill:{quantity:20,price:50}});expect(JSON.stringify({p,trades,allocations})).toBe(original);
});
test('legacy explicit matches on a pre-split exit retain selected rows and profit',()=>{
 const f=fixture();f.p.management={exit:{before:{entryMatches:[{entryKey:'entry',quantity:4}]},after:{entryMatches:[{entryKey:'entry',quantity:6}]}}};const r=ledger(f.p,f.allocations,f.trades);
 expect(r.entryMatching[0].matches).toEqual([{entryKey:'entry',quantity:8}]);expect(r.matchingUnresolved).toBe(0);expect(r.realisedProfit).toBeCloseTo(194.6);
});
test('remembering adjusted matches and rebuilding does not apply the split twice',()=>{
 const f=fixture(),a=ledger(f.p,f.allocations,f.trades);f.p.management=remember(f.p,a);const b=ledger(f.p,f.allocations,f.trades);
 expect(b.matchingUnresolved).toBe(0);expect(b.entryMatching.map(r=>r.matches)).toEqual(a.entryMatching.map(r=>r.matches));expect(b.realisedProfit).toBe(a.realisedProfit);expect(b.openQuantity).toBe(a.openQuantity);
});
test('multiple and reverse splits compose and future events do not apply',()=>{
 const f=fixture([{date:'2026-02-01',ratio:4},{date:'2026-02-02',ratio:.5},{date:'2099-01-01',ratio:10}]);const r=ledger(f.p,f.allocations,f.trades);expect(r.entered).toBe(20);expect(r.realisedProfit).toBeCloseTo(194.6);
});
test('partial entry linking retains original source capacity and scales costs only once',()=>{
 const f=fixture();f.allocations[0].quantity=5;const r=ledger(f.p,[f.allocations[0],f.allocations[2]],f.trades);expect(r.entered).toBe(10);expect(r.openQuantity).toBe(4);expect(r.entryCost).toBe(500);expect(r.realisedProfit).toBeCloseTo(116.4);expect(r.records[0].source_snapshot.quantity).toBe(10);
});
test('unlinking and relinking the same fill is idempotent',()=>{
 const f=fixture(),a=ledger(f.p,f.allocations,f.trades);expect(ledger(f.p,f.allocations.slice(0,2),f.trades).openQuantity).toBe(12);const b=ledger(f.p,f.allocations,f.trades);expect(b.entryMatching).toEqual(a.entryMatching);expect(b.realisedProfit).toBe(a.realisedProfit);
});
test('post-split buys are not doubled',()=>{
 const f=fixture();f.t.executions[0].datetime='2026-02-01T10:00:00Z';const a=sourceFills(f.t)[0];f.allocations[0]={...f.allocations[0],source_snapshot:a};const r=ledger(f.p,[f.allocations[0],f.allocations[2]],f.trades);expect(r.entered).toBe(10);expect(r.openQuantity).toBe(4);
});
test('malformed or incompatible split evidence blocks verified financial results',()=>{
 for(const evidence of [{currency:'USD',splits:[{date:'2026-02-01',ratio:0}]},{currency:'GBP',splits:[{date:'2026-02-01',ratio:2}]},{currency:'USD',splits:[{date:'2026-02-01',ratio:2},{date:'2026-02-01',ratio:2}]}]){
  const f=fixture();f.trades.planningSplits.SYN=evidence;const r=ledger(f.p,f.allocations,f.trades);expect(r.splitUnresolved).toBeGreaterThan(0);expect(r.coverageComplete).toBe(false);expect(r.realisedProfit).toBeNull();
 }
});
test('non-stock contracts ignore underlying share splits',()=>{
 const f=fixture();f.p.definition.instrument='cfd';f.t.instrument_type='cfd';f.allocations=sourceFills(f.t).map((s,i)=>({...f.allocations[i],source_snapshot:s}));expect(ledger(f.p,f.allocations,f.trades).entered).toBe(10);
});

test('old saved match basis advances across a newly effective split without changing strategy rows',()=>{
 const f=fixture();f.p.management={exit:{before:{entryMatches:[{entryKey:'entry',quantity:4}],entryMatchBasisDate:'2026-01-31'},after:{entryMatches:[{entryKey:'entry',quantity:6}],entryMatchBasisDate:'2026-02-04'}}};
 const r=ledger(f.p,f.allocations,f.trades,{asOf:'2026-02-04'});expect(r.matchingUnresolved).toBe(0);expect(r.entryMatching[0].matches[0].quantity).toBe(8);expect(r.entryMatching[1].matches[0].quantity).toBe(6);
});
test('mixed-date entries use their own split factors and chosen cost bases',()=>{
 const f=fixture();f.p.definition.entries.push({key:'new'});f.t.executions.push({id:'new',action:'buy',quantity:3,price:60,datetime:'2026-02-02T10:00:00Z',commission:0});
 const fill=sourceFills(f.t).find(s=>s.key==='id:new');f.allocations.push({id:'new',trade_id:f.t.id,stage_key:'new',action:'entry',quantity:3,source_key:fill.key,source_snapshot:fill});
 f.p.management={exit:{after:{entryMatches:[{entryKey:'new',quantity:3},{entryKey:'entry',quantity:3}],entryMatchBasisDate:'2026-02-04'}}};
 const r=ledger(f.p,f.allocations,f.trades,{asOf:'2026-02-04'});expect(r.entered).toBe(23);expect(r.exited).toBe(14);expect(r.openQuantity).toBe(9);expect(r.entryCost).toBe(1180);expect(r.records.find(r=>r.source_key==='id:new').quantity).toBe(3);expect(r.realisedProfit).toBeCloseTo(164.9);
});
test('ambiguous legacy matches spanning both split bases require a fresh match instead of guessing',()=>{
 const f=fixture();f.allocations[2].stage_key='before';f.p.management={exit:{before:{entryMatches:[{entryKey:'entry',quantity:10}]}}};const r=ledger(f.p,f.allocations,f.trades);expect(r.matchingUnresolved).toBeGreaterThan(0);expect(r.realisedProfit).toBeNull();
});
test('split-aware source attachment exposes market evidence without modifying original trades',()=>{
 const f=fixture();const groups=[];groups.sourceTrades=[];groups.marketSplits=f.trades.planningSplits;const original=JSON.stringify(f.trades);const attached=require('../../src/services/planBrokerFills').attachSources(f.trades,[],groups);expect(attached.planningSplits).toEqual(groups.marketSplits);expect(JSON.stringify(f.trades)).toBe(original);expect(ledger(f.p,f.allocations,attached).openQuantity).toBe(6);
});
