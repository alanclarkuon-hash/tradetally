jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerSync/igLedgerStatement',()=>({read:jest.fn()}));
jest.mock('../../src/services/brokerSync/igCsvReconciliation',()=>({reconcile:jest.fn()}));
jest.mock('../../src/services/brokerSync/igImport',()=>({importAccounts:jest.fn()}));
jest.mock('../../src/services/manualPortfolioMaintenance',()=>({rebuild:jest.fn()}));
const ledger=require('../../src/services/brokerSync/igLedgerStatement'),csv=require('../../src/services/brokerSync/igCsvReconciliation'),imports=require('../../src/services/brokerSync/igImport'),maintenance=require('../../src/services/manualPortfolioMaintenance'),{ingest}=require('../../src/services/brokerSync/igLedgerImport');
const event={reference:'email:CS123',cash:.11,time:'2026-01-10T04:00:00.000Z',type:'interest',description:'Cash interest'};
let rows,backup,client;
beforeEach(()=>{
 jest.resetAllMocks();rows=[{account_identifier:'ig:demo',payload:{igFileInput:{ledgerAccountId:'DEMO',kind:'share_dealing',emailCashRecords:[event],transactions:'synthetic'}}}];backup=jest.fn();client={query:jest.fn().mockResolvedValue({rows})};
 ledger.read.mockResolvedValue({kind:'ledger',account:'DEMO',from:'2026-01-01',to:'2026-01-14',records:[event,{...event,reference:'email:CS456',time:'2026-01-11T04:00:00.000Z'}]});
 csv.reconcile.mockImplementation(async(u,b)=>b);maintenance.rebuild.mockResolvedValue({failed:false});
 imports.importAccounts.mockImplementation(async(u,inputs,opts)=>{if(!opts.dryRun){await opts.beforeImport(client);await opts.beforeCommit(client);}return {importedEvents:1};});
});
test('combines overlapping native refs once and commits the durable receipt with the import',async()=>{
 const result=await ingest('owner',Buffer.alloc(0),'',rows,{fingerprint:'hash',backup});expect(result.status).toBe('imported');
 expect(csv.reconcile.mock.calls[0][1].emailCashRecords).toHaveLength(2);expect(backup).toHaveBeenCalledTimes(1);
 expect(imports.importAccounts.mock.calls.map(c=>c[2].dryRun)).toEqual([true,false]);
 expect(client.query.mock.calls[0][0]).toContain('NOT a.is_archived');
 expect(client.query.mock.calls[1]).toEqual([expect.stringContaining("status='imported'"),['owner','hash','2026-01-14','ig:demo',expect.any(String)]]);
 expect(maintenance.rebuild).toHaveBeenCalledWith('owner','ig',['ig:demo'],'2026-01-01');
});
test.each(['account','conflict','reconciliation','backup'])('refuses unsafe input before any committed import: %s',async problem=>{
 if(problem==='account')rows[0].payload.igFileInput.ledgerAccountId='OTHER';
 if(problem==='conflict')rows[0].payload.igFileInput.emailCashRecords=[{...event,cash:.12}];
 if(problem==='reconciliation')csv.reconcile.mockRejectedValue(Error('Transactions do not reconcile'));
 if(problem==='backup')backup.mockRejectedValue(Error('backup failed'));
 await expect(ingest('owner',Buffer.alloc(0),'',rows,{fingerprint:'hash',backup})).rejects.toThrow();
 expect(imports.importAccounts.mock.calls.some(c=>c[2].dryRun===false)).toBe(false);expect(maintenance.rebuild).not.toHaveBeenCalled();
});
test('a concurrent account change aborts before the receipt commit',async()=>{
 client.query.mockResolvedValue({rows:[]});await expect(ingest('owner',Buffer.alloc(0),'',rows,{fingerprint:'hash',backup})).rejects.toThrow('changed_accounts');
 expect(client.query.mock.calls).toHaveLength(1);expect(maintenance.rebuild).not.toHaveBeenCalled();
});
