jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../src/services/brokerSync/etoroWorkbook',()=>({read:jest.fn()}));
jest.mock('../../src/services/backup.service',()=>({createFullSiteBackup:jest.fn()}));
jest.mock('../../src/services/manualPortfolioMaintenance',()=>({rebuild:jest.fn().mockResolvedValue({rebuilt:2,warnings:[]})}));
jest.mock('../../src/utils/currencyConverter',()=>({getRateMap:jest.fn().mockResolvedValue({GBP:.8})}));
const db=require('../../src/config/database'),workbook=require('../../src/services/brokerSync/etoroWorkbook'),backup=require('../../src/services/backup.service');
const {prepare}=require('../../src/services/brokerSync/etoroCashStatement');
const service=require('../../src/services/brokerSync/etoroUploads');
const row=(Date,Type,Amount,Balance)=>({Date,Type,Amount,Balance,'Position ID':'synthetic','Realized Equity Change':Amount});
const original=[row('01/01/2026 12:00:00','Deposit',100,100),row('02/01/2026 12:00:00','Dividend',2,102)];
const newer=row('03/01/2026 12:00:00','Interest Payment',3,105);
function base(){return {account:{id:'a',connection_id:'c',account_name:'Synthetic',account_identifier:'synthetic',initial_balance_date:'2026-01-01',currency:'USD',broker_metadata:{}},report:{currency:'USD',from_date:'2026-01-01',to_date:'2026-01-02',starting_cash:0,ending_cash:102,records:prepare({'Account Activity':original,Dividends:[]}).records}};}
function upload(rows=[original[1],newer]){return {username:'synthetic-user',start:'2026-01-02',end:'2026-01-03',equity:{openingTotalUSD:110,closingTotalUSD:135},statement:{'Account Activity':rows,Dividends:[]}};}
beforeEach(()=>{jest.clearAllMocks();const b=base();db.query.mockImplementation(async sql=>({rows:sql.includes('user_accounts')?[b.account]:sql.includes('SELECT * FROM broker_cash_reports')?[b.report]:[],rowCount:1}));db.withTransaction.mockImplementation(fn=>fn(db));workbook.read.mockResolvedValue(upload());backup.createFullSiteBackup.mockResolvedValue({});});
test('partial statements use the saved opening cash, retain old history and add only new income',()=>{const d=service.combine(base(),upload());expect(d.records).toHaveLength(3);expect(d.added).toHaveLength(1);expect(d.endingCash).toBe(105);expect(d.added[0]).toMatchObject({type:'interest',cash:3,amount:3});});
test('full history and repeated partial statements add no duplicate financial rows',()=>{const b=base();const d=service.combine(b,upload([...original,newer]));const next={...b,report:{...b.report,records:d.records,to_date:d.end,ending_cash:d.endingCash}};expect(service.combine(next,upload()).added).toHaveLength(0);});
test('changed, missing, older and non-overlapping activity is rejected',()=>{expect(()=>service.combine(base(),upload([{...original[1],Amount:4},newer]))).toThrow(/overlap|differs/);expect(()=>service.combine(base(),upload([newer]))).toThrow(/overlap/);expect(()=>service.combine(base(),{...upload(),end:'2026-01-01'})).toThrow(/before/);expect(()=>service.combine(base(),upload([original[0],newer]))).toThrow(/differs|missing/);});
test('once bound, the statement username must match the account',()=>{const b=base();b.account.broker_metadata.statement_identity_hash='different';expect(()=>service.combine(b,upload())).toThrow(/different eToro account/);});
test('new unmatched dividend details and unknown cash activity stop the update',()=>{const u=upload();u.statement.Dividends=[{'Date of Payment':'03/01/2026','Position ID':'unknown','Net Dividend Received (USD)':1}];expect(()=>service.combine(base(),u)).toThrow(/new dividend details/);expect(()=>service.combine(base(),upload([original[1],{...newer,Type:'Mystery movement'}]))).toThrow(/new activity type/);});
test('equal legitimate payments are retained and removing one from the overlap is rejected',()=>{const second={...original[1],Balance:104};const b=base();b.report.records=prepare({'Account Activity':[...original,second],Dividends:[]}).records;b.report.ending_cash=104;expect(service.combine(b,upload([original[1],second,{...newer,Balance:107}])).added).toHaveLength(1);expect(()=>service.combine(b,upload([original[1],{...newer,Balance:107}]))).toThrow(/differs/);});
test('preview is read-only and its token cannot be used by another owner',async()=>{const p=await service.preview('owner','a',{originalname:'statement.xlsx',buffer:Buffer.from('x')});expect(p).toMatchObject({newRecords:1,newIncome:3,closingCash:105});expect(db.withTransaction).not.toHaveBeenCalled();expect(backup.createFullSiteBackup).not.toHaveBeenCalled();await expect(service.apply('other',p.token)).rejects.toThrow(/expired/);});
test('apply backs up first, commits one event and consumes its token',async()=>{const p=await service.preview('owner','a',{originalname:'statement.xlsx',buffer:Buffer.from('x')});const r=await service.apply('owner',p.token);expect(r).toMatchObject({newRecords:1,newEvents:1,closingCash:105});expect(backup.createFullSiteBackup.mock.invocationCallOrder[0]).toBeLessThan(db.withTransaction.mock.invocationCallOrder[0]);await expect(service.apply('owner',p.token)).rejects.toThrow(/expired/);});
test('backup failure and changed report prevent any transaction',async()=>{const p=await service.preview('owner','a',{originalname:'statement.xlsx',buffer:Buffer.from('x')});backup.createFullSiteBackup.mockRejectedValueOnce(Error('Backup unavailable'));await expect(service.apply('owner',p.token)).rejects.toThrow('Backup unavailable');expect(db.withTransaction).not.toHaveBeenCalled();db.query.mockResolvedValue({rows:[]});await expect(service.apply('owner',p.token)).rejects.toThrow();expect(db.withTransaction).not.toHaveBeenCalled();});
test('portfolio values commit inside the same import transaction and reconstruction runs afterward',async()=>{
 const p=await service.preview('history','a',{originalname:'statement.xlsx',buffer:Buffer.from('x')});
 expect(p.portfolioDates).toBe(2);
 const result=await service.apply('history',p.token);
 const writes=db.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO portfolio_statement_values'));
 expect(writes.map(([,args])=>args.slice(2,5))).toEqual([['2026-01-01',10,100],['2026-01-03',30,105]]);
 expect(writes.every(([sql])=>sql.includes('ON CONFLICT'))).toBe(true);
 expect(result.portfolioDates).toBe(2);
 expect(require('../../src/services/manualPortfolioMaintenance').rebuild).toHaveBeenCalledWith('history','etoro',['synthetic'],'2026-01-01');
});
test('invalid statement totals prevent preview and financial writes',async()=>{
 workbook.read.mockResolvedValue({...upload(),equity:{openingTotalUSD:110,closingTotalUSD:5}});
 await expect(service.preview('bad-total','a',{originalname:'statement.xlsx',buffer:Buffer.from('x')})).rejects.toThrow('equity');
 expect(db.withTransaction).not.toHaveBeenCalled();
});
