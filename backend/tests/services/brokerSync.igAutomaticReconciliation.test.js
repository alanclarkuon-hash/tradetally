jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerSync/igCsvReconciliation',()=>({reconcile:jest.fn()}));
jest.mock('../../src/services/brokerSync/igImport',()=>({importAccounts:jest.fn()}));
jest.mock('../../src/services/manualPortfolioMaintenance',()=>({rebuild:jest.fn()}));
const db=require('../../src/config/database'),csv=require('../../src/services/brokerSync/igCsvReconciliation'),imports=require('../../src/services/brokerSync/igImport'),maintenance=require('../../src/services/manualPortfolioMaintenance'),{run}=require('../../src/services/brokerSync/igAutomaticReconciliation');
const row={account_identifier:'synthetic',payload:{igFileInput:{kind:'share_dealing',transactions:'private synthetic'}}};
beforeEach(()=>{jest.clearAllMocks();db.query.mockImplementation(async sql=>({rows:sql.includes('SELECT account_identifier,statement_date')?[{account_identifier:'synthetic',statement_date:'2026-01-02',reason:'activity_pending'}]:sql.includes('SELECT account_identifier,payload')?[row]:[]}));csv.reconcile.mockResolvedValue({...row.payload.igFileInput,changed:true});imports.importAccounts.mockResolvedValue({});maintenance.rebuild.mockResolvedValue({failed:false});});
test('automatically validates, backs up and imports pending evidence then rebuilds selected history',async()=>{
 const backup=jest.fn().mockResolvedValue({});
 imports.importAccounts.mockImplementation(async(_,__,options)=>{if(options.beforeImport)await options.beforeImport();return {};});
 const result=await run('owner',{backup});
 expect(result.reconciled).toBe(true);expect(backup).toHaveBeenCalledTimes(1);expect(imports.importAccounts.mock.calls.map(c=>c[2].dryRun)).toEqual([true,false]);
 expect(csv.reconcile).toHaveBeenCalledWith('owner',row.payload.igFileInput,'private synthetic');expect(maintenance.rebuild).toHaveBeenCalledWith('owner','ig',['synthetic'],'2026-01-02');
 expect(backup.mock.invocationCallOrder[0]).toBeGreaterThan(imports.importAccounts.mock.invocationCallOrder[0]);
});
test('incomplete evidence stays pending without backup or financial application',async()=>{
 csv.reconcile.mockRejectedValue(Error('IG upload: Transactions do not reconcile'));
 const backup=jest.fn();expect((await run('owner',{backup})).reconciled).toBe(false);expect(backup).not.toHaveBeenCalled();expect(imports.importAccounts).not.toHaveBeenCalled();
});
test('maintenance retries use derived data without replaying financial imports',async()=>{
 db.query.mockImplementation(async sql=>({rows:sql.includes('SELECT account_identifier,statement_date')?[{account_identifier:'synthetic',statement_date:'2026-01-02',reason:'maintenance'}]:sql.includes('SELECT account_identifier,payload')?[row]:[]}));
 await run('owner',{backup:jest.fn()});expect(imports.importAccounts).not.toHaveBeenCalled();expect(maintenance.rebuild).toHaveBeenCalled();expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SET reason=NULL'),['owner','synthetic']);
});
test('a snapshot change during backup prevents automatic financial application',async()=>{
 let read=0;db.query.mockImplementation(async sql=>({rows:sql.includes('SELECT account_identifier,statement_date')?[{account_identifier:'synthetic',statement_date:'2026-01-02',reason:'activity_pending'}]:sql.includes('SELECT account_identifier,payload')?[++read===1?row:{...row,payload:{changed:true}}]:[]}));
 imports.importAccounts.mockImplementation(async(_,__,options)=>{if(options.beforeImport)await options.beforeImport();});
 await expect(run('owner',{backup:jest.fn()})).rejects.toThrow('account changed');expect(maintenance.rebuild).not.toHaveBeenCalled();
});
test('failed maintenance remains marked for a future automatic retry',async()=>{
 maintenance.rebuild.mockResolvedValue({failed:true});expect((await run('owner',{backup:jest.fn()})).maintenanceFailed).toBe(true);
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining("SET reason='maintenance'"),['owner','synthetic']);
});

test.each([true,false])('conflict-only automatic retry applies only provably resolvable evidence (%s)',async resolvable=>{
 const input={name:'Synthetic',identity:'demo',kind:'share_dealing',transactions:'TextDate,DateUtc,Reference,MarketName,TransactionType,PL Amount,CurrencyIsoCode\nx,2026-10-01T12:00:00,old,Cash Interest Paid,DEPO,10,GBP',confirmation:{cash:10,cutoff:'2026-10-06T23:59:59Z',holdings:[]}};
 const saved={account_identifier:'synthetic',payload:{igFileInput:input}};
 const point={date:'2026-10-02',cash:10,holdings:0,positions:[],records:[],activitySupported:true};
 db.query.mockImplementation(async sql=>({rows:sql.includes('SELECT account_identifier,statement_date')?[{account_identifier:'synthetic',statement_date:point.date,reason:'conflicting_statement'}]:sql.includes('SELECT account_identifier,payload')?[saved]:sql.includes('SELECT status,reason,evidence')?[{status:'conflict',reason:'conflicting_statement',evidence:point},{status:'imported',evidence:{...point,date:'2026-10-05',cash:resolvable?10:99}}]:[]}));
 csv.reconcile.mockResolvedValue(input);
 const backup=jest.fn().mockResolvedValue({});
 expect((await run('owner',{backup})).reconciled).toBe(resolvable);
 expect(backup).toHaveBeenCalledTimes(resolvable?1:0);
 expect(imports.importAccounts).toHaveBeenCalledTimes(resolvable?2:0);
});
