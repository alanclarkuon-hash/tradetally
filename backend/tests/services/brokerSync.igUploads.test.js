jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerSync/igPdf',()=>({text:jest.fn(),confirmation:jest.fn()}));
jest.mock('../../src/services/brokerSync/igStatement',()=>({...jest.requireActual('../../src/services/brokerSync/igStatement'),prepare:jest.fn()}));
jest.mock('../../src/services/brokerSync/igImport',()=>({importAccounts:jest.fn()}));
jest.mock('../../src/services/backup.service',()=>({createFullSiteBackup:jest.fn()}));
jest.mock('../../src/services/manualPortfolioMaintenance',()=>({rebuild:jest.fn().mockResolvedValue({rebuilt:2,warnings:[]})}));
const db=require('../../src/config/database'),pdf=require('../../src/services/brokerSync/igPdf'),{importAccounts}=require('../../src/services/brokerSync/igImport');
const service=require('../../src/services/brokerSync/igUploads'),backup=require('../../src/services/backup.service');
const id='12345678-1234-1234-1234-123456789abc';
function rows(){return [{id,account_name:'Synthetic',captured_at:'2026-06-01',payload:{igFileInput:{name:'Synthetic',kind:'share_dealing',ledgerAccountId:'SYNTH',confirmation:{holdings:[]}}}}];}
function files(){return ['transactions','trading','ledger'].map(f=>({fieldname:`${id}:${f}`,size:10,buffer:Buffer.from('synthetic')}));}
beforeEach(()=>{jest.clearAllMocks();require('../../src/services/brokerSync/igStatement').prepare.mockReturnValue({identifier:'synthetic',from:'2026-01-01',records:[]});db.query.mockResolvedValue({rows:rows()});pdf.text.mockResolvedValue('PDF');pdf.confirmation.mockReturnValue({cash:25,holdings:[]});importAccounts.mockResolvedValue({accounts:[{name:'Synthetic',cash:25}],importedTrades:0,importedEvents:0});backup.createFullSiteBackup.mockResolvedValue({});});
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
test('multiple earlier execution PDFs are read privately alongside the required latest statements',async()=>{
  const extras=[1,2].map(n=>({fieldname:`${id}:execution`,size:10,buffer:Buffer.from(`earlier-${n}`)}));
  await service.preview('user-g',[...files(),...extras]);expect(pdf.text).toHaveBeenCalledTimes(4);
  expect(importAccounts).toHaveBeenCalledWith('user-g',expect.arrayContaining([expect.objectContaining({shareTrades:[]})]),{dryRun:true});
});
function spreadRows(){return [{...rows()[0],payload:{igFileInput:{kind:'spread_bet',ledgerAccountId:'SYNTH',statementMask:'S***1',statementLabel:'Synthetic',confirmation:{cutoff:'2026-10-03T10:00:00Z'}}}}];}
const dailyText='20 August 2026\nAccount No. S***1\nAccount Name Synthetic\nFunds 100.00\nRunning Profit Or Loss -2.00\nEquity 98.00';
test('daily-only imports validate dated equity against saved cash and deduplicate repeated PDFs',async()=>{
 db.query.mockResolvedValue({rows:spreadRows()});pdf.text.mockResolvedValue(dailyText);
 require('../../src/services/brokerSync/igStatement').prepare.mockReturnValue({identifier:'synthetic',from:'2026-01-01',records:[{time:'2026-08-19T12:00:00Z',cash:100}]});
 const f={fieldname:`${id}:daily`,size:10,buffer:Buffer.from('pdf')};
 await service.preview('daily-owner',[f,f]);
 expect(pdf.confirmation).not.toHaveBeenCalled();
 expect(importAccounts.mock.calls[0][1][0].statementValues).toEqual([{date:'2026-08-20',cash:100,holdings:-2}]);
});
test('conflicting daily values stop preview before any import',async()=>{
 db.query.mockResolvedValue({rows:spreadRows()});
 require('../../src/services/brokerSync/igStatement').prepare.mockReturnValue({identifier:'synthetic',from:'2026-01-01',records:[{time:'2026-08-19T12:00:00Z',cash:100}]});
 pdf.text.mockResolvedValueOnce(dailyText).mockResolvedValueOnce(dailyText.replace('-2.00','-3.00').replace('98.00','97.00'));
 const f={fieldname:`${id}:daily`,size:10,buffer:Buffer.from('pdf')};
 await expect(service.preview('conflict',[f,f])).rejects.toThrow('disagree');expect(importAccounts).not.toHaveBeenCalled();
});
