const {reconciled}=require('../../src/services/brokerSync/igEmailReconciliation');
jest.mock('../../src/services/brokerSync/igStatementIngester',()=>({samePoint:(stored,p)=>Math.round(stored.cash_usd*stored.gbp_per_usd*100)===Math.round(p.cash*100)&&Math.round(stored.holdings_usd*stored.gbp_per_usd*100)===Math.round(p.holdings*100)}));
const event={time:'2026-10-05T04:00:00.000Z',cash:1,type:'interest',description:'Cash interest'};
const point={date:'2026-10-05',cash:11,activitySupported:true,records:[event]};

test('a ledger-verified conflict corrects its anchor and saved snapshot without changing original evidence',async()=>{
 const {clear}=require('../../src/services/brokerSync/igEmailReconciliation');
 const evidence={...point,holdings:4,positions:[{isin:'synthetic',quantity:2,cost:3,value:4}]};
 const later={...evidence,date:'2026-10-06',holdings:6,positions:[{...evidence.positions[0],value:6}]};
 const client={query:jest.fn().mockResolvedValueOnce({rows:[{id:'old',status:'conflict',reason:'conflicting_statement',evidence},{id:'later',status:'imported',evidence:later}]}).mockResolvedValueOnce({rows:[{cash_usd:9,holdings_usd:3,gbp_per_usd:1}]}).mockResolvedValue({rows:[]})};
 await clear(client,'owner','account',[{time:'2026-10-01T00:00:00.000Z',cash:10},event],'2026-10-06T23:59:59Z');
 expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO portfolio_statement_values'),['owner','account','2026-10-05',4,11,1]);
 expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE broker_import_snapshots'),['owner','account','2026-10-05',JSON.stringify([{date:'2026-10-05',cash:11,holdings:4}])]);
 expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status='imported',reason=NULL"),['old','owner']);
 expect(client.query.mock.calls.some(([sql])=>sql.includes('evidence='))).toBe(false);
});

test('a contradictory conflict resolves from later history but preserves an independent chart anchor',async()=>{
 const {clear}=require('../../src/services/brokerSync/igEmailReconciliation');
 const evidence={...point,cash:5,holdings:0,positions:[]},later={...evidence,date:'2026-10-06',cash:11};
 const client={query:jest.fn().mockResolvedValueOnce({rows:[{id:'old',status:'conflict',reason:'conflicting_statement',evidence},{id:'later',status:'imported',evidence:later}]}).mockResolvedValueOnce({rows:[{cash_usd:11,holdings_usd:0,gbp_per_usd:1}]}).mockResolvedValue({rows:[]})};
 await clear(client,'owner','account',[{time:'2026-10-01T00:00:00.000Z',cash:10},event],'2026-10-06T23:59:59Z');
 expect(client.query).toHaveBeenCalledWith(expect.stringContaining("reason='resolved_by_later_history'"),['old','owner']);
 expect(client.query.mock.calls.some(([sql])=>sql.includes('DELETE')||sql.includes('INSERT INTO portfolio_statement_values'))).toBe(false);
});

test('conflict correction requires covered activity, unchanged positions, reconciled later cash and unambiguous daily evidence',()=>{
 const {conflictResolution}=require('../../src/services/brokerSync/igEmailReconciliation');
 const p={...point,holdings:4,positions:[{isin:'synthetic',quantity:2,cost:3,value:4}]},later={...p,date:'2026-10-06'};
 const records=[{time:'2026-10-01T00:00:00.000Z',cash:10},event],rows=[{status:'conflict',evidence:p},{status:'imported',evidence:later}];
 expect(conflictResolution(p,rows,records,'2026-10-06')).toBe('correct');
 expect(conflictResolution({...p,activitySupported:false},rows,records,'2026-10-06')).toBeNull();
 expect(conflictResolution(p,[{status:'imported',evidence:{...later,positions:[]}}],records,'2026-10-06')).toBeNull();
 expect(conflictResolution(p,[{status:'imported',evidence:{...later,cash:99}}],records,'2026-10-06')).toBeNull();
 expect(conflictResolution(p,[...rows,{status:'conflict',evidence:{...p,holdings:9}}],records,'2026-10-06')).toBeNull();
 expect(conflictResolution(p,rows,records,'2026-10-04')).toBeNull();
});
test('only a complete matching native ledger clears a pending email valuation',()=>{
 expect(reconciled(point,[{time:'2026-10-01T00:00:00.000Z',cash:10},event])).toBe(true);
 expect(reconciled(point,[event])).toBe(false);
 expect(reconciled({...point,activitySupported:false},[{time:'2026-10-01T00:00:00.000Z',cash:10},event])).toBe(false);
});
test('equal totals with mismatched event timing cannot silently clear a review',()=>{
 expect(reconciled(point,[{time:'2026-10-01T00:00:00.000Z',cash:10},{...event,time:'2026-10-05T05:00:00.000Z'}])).toBe(false);
});
test('conflicting reporting-day cash removes only the matching PDF anchor and preserves receipt evidence',async()=>{
 const {clear}=require('../../src/services/brokerSync/igEmailReconciliation');
 const evidence={...point,cash:5,holdings:2};
 const client={query:jest.fn().mockResolvedValueOnce({rows:[{id:'receipt',reason:'activity_pending',evidence}]}).mockResolvedValueOnce({rows:[{cash_usd:5,holdings_usd:2,gbp_per_usd:1}]}).mockResolvedValue({rows:[]})};
 await clear(client,'owner','account',[{time:'2026-10-01T00:00:00.000Z',cash:10},event],'2026-10-05T23:59:59.000Z');
 expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM portfolio_statement_values'),['owner','account','2026-10-05']);
 expect(client.query).toHaveBeenCalledWith(expect.stringContaining("reason='cash_date_conflict'"),['receipt','owner']);
 expect(client.query.mock.calls.some(([sql])=>sql.includes('evidence='))).toBe(false);
});
test('a different independently stored valuation is never deleted by a conflicting PDF',async()=>{
 const {clear}=require('../../src/services/brokerSync/igEmailReconciliation');
 const client={query:jest.fn().mockResolvedValueOnce({rows:[{id:'receipt',reason:'activity_pending',evidence:{...point,cash:5,holdings:2}}]}).mockResolvedValueOnce({rows:[{cash_usd:11,holdings_usd:2,gbp_per_usd:1}]}).mockResolvedValue({rows:[]})};
 await clear(client,'owner','account',[{time:'2026-10-01T00:00:00.000Z',cash:10},event],'2026-10-05T23:59:59.000Z');
 expect(client.query.mock.calls.some(([sql])=>sql.includes('DELETE'))).toBe(false);
});
test('incomplete history after the reconciled cutoff cannot invalidate a newer statement',async()=>{
 const {clear}=require('../../src/services/brokerSync/igEmailReconciliation');
 const client={query:jest.fn().mockResolvedValue({rows:[{id:'receipt',reason:'activity_pending',evidence:{...point,cash:5}}]})};
 await clear(client,'owner','account',[],'2026-09-30T23:59:59.000Z');
 expect(client.query).toHaveBeenCalledTimes(1);
});
test('later reconciled statement and covered activity resolve a conflict without restoring its chart anchor',async()=>{
 const {clear}=require('../../src/services/brokerSync/igEmailReconciliation');
 const records=[{time:'2026-10-01T00:00:00.000Z',cash:10},event];
 const evidence={...point,cash:5,holdings:2,positions:[]};
 const later={...point,date:'2026-10-06',cash:11,holdings:2,positions:[]};
 const client={query:jest.fn().mockResolvedValueOnce({rows:[{id:'receipt',reason:'cash_date_conflict',status:'imported',evidence},{id:'later',status:'imported',reason:null,evidence:later}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValue({rows:[]})};
 await clear(client,'owner','account',records,'2026-10-06T23:59:59.000Z');
 expect(client.query).toHaveBeenCalledWith(expect.stringContaining("reason='resolved_by_later_history'"),['receipt','owner']);
 expect(client.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO portfolio_statement_values'))).toBe(false);
});
test('unmatched activity, later balance conflicts or changed holdings cannot suppress warnings',()=>{
 const {superseded}=require('../../src/services/brokerSync/igEmailReconciliation');
 const records=[{time:'2026-10-01T00:00:00.000Z',cash:10},event],p={...point,cash:5,positions:[]},later={...point,date:'2026-10-06',positions:[]};
 expect(superseded(p,later,records,'2026-10-06')).toBe(true);
 expect(superseded({...p,activitySupported:false},later,records,'2026-10-06')).toBe(false);
 expect(superseded({...p,records:[{...event,cash:9}]},later,records,'2026-10-06')).toBe(false);
 expect(superseded(p,{...later,cash:12},records,'2026-10-06')).toBe(false);
 expect(superseded(p,{...later,positions:[{isin:'new',quantity:1,cost:1}]},records,'2026-10-06')).toBe(false);
 expect(superseded(p,later,records,'2026-10-05')).toBe(false);
});

