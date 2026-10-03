const ExcelJS=require('exceljs');
const {read}=require('../../src/services/brokerSync/etoroWorkbook');
async function fixture(currency='USD',formula=false){const w=new ExcelJS.Workbook();const s=w.addWorksheet('Account Summary');s.addRows([['Username','synthetic'],['Currency',currency],['Start Date','01/01/2026 00:00:00'],['End Date','31/01/2026 23:59:59']]);w.addWorksheet('Account Activity').addRows([['Date','Type','Amount','Balance','Position ID','Realized Equity Change'],['02/01/2026 12:00:00','Interest Payment',formula?{formula:'1+1',result:2}:2,102,'synthetic',2]]);w.addWorksheet('Dividends').addRow(['Date of Payment','Position ID','Net Dividend Received (USD)']);return Buffer.from(await w.xlsx.writeBuffer());}
test('reads the original XLSX cash sheets and period without retaining the file',async()=>{const p=await read(await fixture());expect(p).toMatchObject({username:'synthetic',start:'2026-01-01',end:'2026-01-31'});expect(p.statement['Account Activity'][0].Amount).toBe(2);});
test('rejects invalid files, non-USD statements and formula cells',async()=>{await expect(read(Buffer.from('csv'))).rejects.toThrow(/XLSX/);await expect(read(await fixture('GBP'))).rejects.toThrow(/USD/);await expect(read(await fixture('USD',true))).rejects.toThrow(/unsupported cell/);});

test('reads namespace-prefixed eToro exports with GBP display columns',async()=>{
  const {createRequire}=require('module');const JSZip=createRequire(require.resolve('exceljs'))('jszip');
  const zip=await JSZip.loadAsync(await fixture('USD/GBP'));
  for(const name of Object.keys(zip.files).filter(n=>/^xl\/(workbook|sharedStrings|worksheets\/sheet\d+)\.xml$/.test(n))){
    const source=await zip.file(name).async('string');
    zip.file(name,source.replace(/xmlns="http:\/\/schemas.openxmlformats.org\/spreadsheetml\/2006\/main"/,'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)([A-Za-z][\w-]*)(?=[\s/>])/g,'<$1x:$2'));
  }
  const result=await read(await zip.generateAsync({type:'nodebuffer'}));
  expect(result.statement['Account Activity'][0].Amount).toBe(2);
});

test('rejects workbook XML declarations that could introduce external entities',async()=>{
  const {createRequire}=require('module');const JSZip=createRequire(require.resolve('exceljs'))('jszip');
  const zip=await JSZip.loadAsync(await fixture());
  zip.file('xl/workbook.xml','<!DOCTYPE workbook SYSTEM "file:///private">'+await zip.file('xl/workbook.xml').async('string'));
  await expect(read(await zip.generateAsync({type:'nodebuffer'}))).rejects.toThrow(/workbook XML/);
});
