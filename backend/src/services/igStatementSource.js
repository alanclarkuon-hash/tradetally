// Source contract: list -> read -> acknowledge after a durable import receipt.
// A cloud Drive adapter can implement the same contract without changing PDFs.
const fs=require('fs/promises'),path=require('path');
function folderSource(root){
 const base=path.resolve(root);
 async function safe(name){
  if(path.basename(name)!==name)throw Error('Invalid ingestion filename');
  const file=path.join(base,name),st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>5*1024*1024)throw Error('Invalid ingestion file');
  const real=await fs.realpath(file),realBase=await fs.realpath(base);
  if(path.dirname(real)!==realBase)throw Error('Invalid ingestion path');return {file,st};
 }
 return {
  async deliveryHealth(){
   try{const entry=await safe('.relay-status.json');if(entry.st.size>8192)throw Error('Invalid delivery status');
    const value=JSON.parse(await fs.readFile(entry.file,'utf8'));return {lastRun:typeof value.lastRun==='string'?value.lastRun:null,errors:Number(value.errors)||0,collector:value.collector?{lastRun:value.collector.lastRun,errors:Number(value.collector.errors)||0}:null};
   }catch(e){if(e.code==='ENOENT')return null;throw e;}
  },
  async list(){return (await fs.readdir(base)).filter(n=>/\.pdf$/i.test(n)).sort();},
  async read(name){
   const {file,st}=await safe(name);if(Date.now()-st.mtimeMs<3000)return null;
   const buffer=await fs.readFile(file),after=await fs.stat(file);
   if(after.size!==st.size||after.mtimeMs!==st.mtimeMs)return null;
   let metadata=null;
   const prefix=name.match(/^([a-f0-9]{64}) - /)?.[1];
   if(prefix){
    // A cloud exporter writes the PDF first and metadata last. Incomplete
    // pairs stay queued rather than being treated as malformed statements.
    try{const meta=await safe(prefix+'.json');if(meta.st.size>8192)throw Error('Invalid metadata');metadata=JSON.parse(await fs.readFile(meta.file,'utf8'));}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
    const actual=require('crypto').createHash('sha256').update(buffer).digest('hex');
    if(metadata.version!==1||metadata.sha256!==actual||prefix!==actual)throw Error('Attachment checksum mismatch');
   }
   return {buffer,metadata,filename:name};
  },
  async acknowledge(name){
   const {file}=await safe(name),destination=path.join(base,'Processed');
   await fs.mkdir(destination,{recursive:true});
   const stat=await fs.lstat(destination);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid archive path');
   // Never overwrite a different archived attachment with the same filename.
   const target=path.join(destination,name);
   try{await fs.access(target);const a=await fs.readFile(file),b=await fs.readFile(target);if(!a.equals(b))throw Error('Archive conflict');await fs.unlink(file);}
   catch(e){if(e.code==='ENOENT')await fs.rename(file,target);else throw e;}
   const prefix=name.match(/^([a-f0-9]{64}) - /)?.[1];
   if(prefix){try{await fs.rename(path.join(base,prefix+'.json'),path.join(destination,prefix+'.json'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  }
 };
}
module.exports={folderSource};
