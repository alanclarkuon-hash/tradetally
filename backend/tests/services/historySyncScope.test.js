jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const db=require('../../src/config/database');
const {capture,difference}=require('../../src/services/historySyncScope');
const state=(rows,latest='2026-10-11')=>({rows:new Map(rows),fallback:'2020-01-01',latest});
const row=(date,count=1)=>({date,count});
test('unchanged inputs and current history do not enqueue work',()=>{
 const before=new Map([['a',state([['same',row('2020-01-01')]])]]);
 expect(difference(before,before,'2026-10-11')).toEqual({accounts:{}});
});
test('added and removed sources recover from the earliest affected date, retaining other brokers outside scope',()=>{
 const before=new Map([['a',state([['old',row('2025-04-01')],['retained',row('2020-01-01')]])]]);
 const after=new Map([['a',state([['new',row('2025-08-01')],['retained',row('2020-01-01')]])]]);
 expect(difference(before,after,'2026-10-11')).toEqual({accounts:{a:'2025-04-01'}});
});
test('unchanged inputs extend only newly missing valuation dates',()=>{
 const before=new Map([['a',state([['same',row('2020-01-01')]],'2026-10-09')]]);
 expect(difference(before,before,'2026-10-11')).toEqual({accounts:{a:'2026-10-09'}});
});
test('new accounts recover from opening and duplicate source multiplicity is not lost',()=>{
 const after=new Map([['new',state([['same',row('2024-01-01')]],null)]]);
 expect(difference(new Map(),after,'2026-10-11')).toEqual({accounts:{new:'2020-01-01'}});
 const before=new Map([['a',state([['same',row('2025-01-01',2)]])]]);
 const current=new Map([['a',state([['same',row('2025-01-01',1)]])]]);
 expect(difference(before,current,'2026-10-11').accounts.a).toBe('2025-01-01');
});
test('capture uses connection accounts, ignores live quotes and row ordering, and detects dated source corrections',async()=>{
 let reverse=false,exit=new Date('2025-05-01'),quote=100;
 db.query.mockImplementation(async(sql,params)=>({rows:
  sql.includes('broker_import_snapshots')?[{account_identifier:'a',connection_id:'connection',payload:{asOf:'2026-10-11',valuation:{quote}}}]:
  sql.includes('user_accounts')?[{id:'id',account_identifier:'a',initial_balance_date:'2020-01-01'},{id:'other',account_identifier:'b'}]:
  sql.includes('FROM trades')?(reverse?[{symbol:'TWO',entry_time:'2025-02-01'},{symbol:'ONE',entry_time:new Date('2025-01-01'),exit_time:exit}]:[{symbol:'ONE',entry_time:new Date('2025-01-01'),exit_time:exit},{symbol:'TWO',entry_time:'2025-02-01'}]):
  sql.includes('MAX(value_date)')?[{latest:'2026-10-11'}]:[]}));
 const before=await capture('user','etoro','connection');
 reverse=true;quote=999;
 expect(difference(before,await capture('user','etoro','connection'),'2026-10-11')).toEqual({accounts:{}});
 exit=new Date('2025-06-01');
 expect(difference(before,await capture('user','etoro','connection'),'2026-10-11').accounts).toEqual({a:'2025-01-01'});
 expect([...before.keys()]).toEqual(['a']);
 expect(db.query.mock.calls.filter(([s])=>s.includes('FROM trades')).every(([,args])=>args[2]==='a')).toBe(true);
});


test('legacy snapshot identifiers cannot silently exclude the synced broker account',async()=>{
 db.query.mockImplementation(async sql=>({rows:sql.includes('broker_import_snapshots')?[{account_identifier:'old-native',connection_id:'connection',payload:{}}]:sql.includes('user_accounts')?[{id:'id',account_identifier:'current',initial_balance_date:'2020-01-01'}]:sql.includes('MAX(value_date)')?[{latest:'2026-10-11'}]:[]}));
 expect([...(await capture('user','etoro','connection')).keys()]).toEqual(['current']);
});
