const fs=require('fs/promises'),os=require('os'),path=require('path'),crypto=require('crypto');
const {relay}=require('../../../scripts/relay-ingestion-folder.cjs');
let root,source,target,name,bytes;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'ig-relay-'));source=path.join(root,'source');target=path.join(root,'target');await fs.mkdir(source);bytes=Buffer.from('%PDF synthetic attachment');const hash=crypto.createHash('sha256').update(bytes).digest('hex');name=hash+' - 5 October 2026 Share dealing Statement.pdf';await fs.writeFile(path.join(source,name),bytes);await fs.utimes(path.join(source,name),new Date(0),new Date(0));await fs.writeFile(path.join(source,hash+'.json'),JSON.stringify({version:1,sha256:hash,statementDate:'2026-10-05'}));});
afterEach(async()=>{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('ig-relay-'))throw Error('Unexpected cleanup target');await fs.rm(root,{recursive:true,force:true});});
test('delivers a complete pair and retains cloud originals before server commitment',async()=>{
 expect(await relay({source,target})).toMatchObject({copied:1,archived:0,errors:0});expect(await fs.readFile(path.join(target,name))).toEqual(bytes);expect(await fs.readFile(path.join(source,name))).toEqual(bytes);
 expect(await relay({source,target})).toMatchObject({copied:0,archived:0,errors:0});
});
test('only a matching processed receipt allows archival',async()=>{
 await relay({source,target});await fs.mkdir(path.join(target,'Processed'));await fs.rename(path.join(target,name),path.join(target,'Processed',name));
 expect(await relay({source,target})).toMatchObject({archived:1,errors:0});expect(await fs.readFile(path.join(source,'Processed',name))).toEqual(bytes);
});
test('checksum failure leaves input in place and stages nothing',async()=>{
 await fs.writeFile(path.join(source,name),'%PDF changed');await fs.utimes(path.join(source,name),new Date(0),new Date(0));
 expect(await relay({source,target})).toMatchObject({copied:0,archived:0,errors:1});expect(await fs.readdir(source)).toContain(name);
});
