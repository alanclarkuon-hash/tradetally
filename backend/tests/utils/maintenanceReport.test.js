const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const {maintenancePaths,writePrivateReport}=require('../../src/utils/maintenanceReport');
test('maintenance rejects repository backup, report and configuration destinations before opening them',()=>{
 const external=path.join(os.tmpdir(),'synthetic-maintenance.json'), repo=path.resolve(__dirname,'../../synthetic-private.json');
 for(const name of ['env-file','report','backup']){
  const args=[`--env-file=${external}`,`--report=${external}`,`--backup=${external}`,'--apply'].map(a=>a.startsWith(`--${name}=`)?`--${name}=${repo}`:a);
  expect(()=>maintenancePaths(args)).toThrow(/outside source/);
 }
 expect(()=>maintenancePaths([])).toThrow(/absolute/);
});
test('private reports use exclusive durable creation outside source and never overwrite evidence',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-maintenance-')),file=path.join(dir,'report.json');
 try{writePrivateReport(file,{synthetic:true});expect(JSON.parse(fs.readFileSync(file))).toEqual({synthetic:true});expect(()=>writePrivateReport(file,{})).toThrow();}
 finally{fs.rmSync(dir,{recursive:true});}
});
