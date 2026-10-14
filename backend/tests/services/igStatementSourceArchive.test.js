const fs=require('fs/promises'),path=require('path'),os=require('os'),{folderSource}=require('../../src/services/igStatementSource');
let root;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'ig-archive-test-'));});
afterEach(async()=>{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('ig-archive-test-'))throw Error('Unsafe cleanup');await fs.rm(root,{recursive:true,force:true});});
test('preflight creates the archive and permits durable duplicate acknowledgement',async()=>{
 const s=folderSource(root);await fs.writeFile(path.join(root,'synthetic.pdf'),'%PDF synthetic');await s.checkArchive();await s.acknowledge('synthetic.pdf');
 await fs.writeFile(path.join(root,'synthetic.pdf'),'%PDF synthetic');await s.acknowledge('synthetic.pdf');expect(await fs.readFile(path.join(root,'Processed','synthetic.pdf'),'utf8')).toBe('%PDF synthetic');
});
test('non-directory archive blocks preflight without moving input documents',async()=>{
 await fs.writeFile(path.join(root,'Processed'),'unchanged');await fs.writeFile(path.join(root,'synthetic.pdf'),'%PDF synthetic');
 await expect(folderSource(root).checkArchive()).rejects.toThrow('Invalid archive path');expect(await fs.readFile(path.join(root,'synthetic.pdf'),'utf8')).toBe('%PDF synthetic');
});
