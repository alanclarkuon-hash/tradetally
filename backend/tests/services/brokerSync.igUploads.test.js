jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerSync/igPdf',()=>({text:jest.fn(),confirmation:jest.fn()}));
jest.mock('../../src/services/brokerSync/igStatement',()=>({prepare:jest.fn()}));
jest.mock('../../src/services/brokerSync/igImport',()=>({importAccounts:jest.fn()}));
jest.mock('../../src/services/backup.service',()=>({createFullSiteBackup:jest.fn()}));
const db=require('../../src/config/database'),pdf=require('../../src/services/brokerSync/igPdf'),{importAccounts}=require('../../src/services/brokerSync/igImport');
const service=require('../../src/services/brokerSync/igUploads'),backup=require('../../src/services/backup.service');
const id='12345678-1234-1234-1234-123456789abc';
function rows(){return [{id,account_name:'Synthetic',captured_at:'2026-06-01',payload:{igFileInput:{name:'Synthetic',kind:'share_dealing',ledgerAccountId:'SYNTH',confirmation:{holdings:[]}}}}];}
function files(){return ['transactions','trading','ledger'].map(f=>({fieldname:`${id}:${f}`,size:10,buffer:Buffer.from('synthetic')}));}
beforeEach(()=>{jest.clearAllMocks();db.query.mockResolvedValue({rows:rows()});pdf.text.mockResolvedValue('PDF');pdf.confirmation.mockReturnValue({cash:25,holdings:[]});importAccounts.mockResolvedValue({accounts:[{name:'Synthetic',cash:25}],importedTrades:0,importedEvents:0});backup.createFullSiteBackup.mockResolvedValue({});});
test('preview runs rollback-only validation; another user cannot apply its token',async()=>{
  const p=await service.preview('user-a',files());
  expect(importAccounts).toHaveBeenCalledWith('user-a',expect.any(Array),{dryRun:true});
  expect(backup.createFullSiteBackup).not.toHaveBeenCalled();
  await expect(service.apply('user-b',p.token)).rejects.toThrow(/expired/);
});
test('apply requires a backup, applies once and consumes the preview token',async()=>{
  const p=await service.preview('user-c',files());await service.apply('user-c',p.token);
  expect(backup.createFullSiteBackup).toHaveBeenCalledWith('user-c');
  expect(importAccounts).toHaveBeenLastCalledWith('user-c',expect.any(Array),{dryRun:false});
  expect(backup.createFullSiteBackup.mock.invocationCallOrder[0]).toBeLessThan(importAccounts.mock.invocationCallOrder[1]);
  await expect(service.apply('user-c',p.token)).rejects.toThrow(/expired/);
});
test('a missing backup prevents apply',async()=>{
  const p=await service.preview('user-d',files());backup.createFullSiteBackup.mockRejectedValueOnce(Error('Backup unavailable'));
  await expect(service.apply('user-d',p.token)).rejects.toThrow('Backup unavailable');expect(importAccounts).toHaveBeenCalledTimes(1);
});
test('changed saved account state invalidates preview',async()=>{
  const p=await service.preview('user-e',files());db.query.mockResolvedValue({rows:[{...rows()[0],captured_at:'2026-06-02'}]});
  await expect(service.apply('user-e',p.token)).rejects.toThrow(/updated after/);expect(backup.createFullSiteBackup).not.toHaveBeenCalled();
});
test('a file for another account is rejected and incomplete reports never reach importer',async()=>{
  await expect(service.preview('user-f',[{...files()[0],fieldname:'87654321-1234-1234-1234-123456789abc:transactions'}])).rejects.toThrow(/selected account/);
  await expect(service.preview('user-f',[files()[0]])).rejects.toThrow(/every requested report/);expect(importAccounts).not.toHaveBeenCalled();
});
