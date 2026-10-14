// Bridge a cloud desktop streaming drive to an ordinary container bind folder.
// JSON config and statements stay private. This relay never parses finances.
const fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function regular(root,name){
 if(path.basename(name)!==name)throw Error('Invalid filename');
 const file=path.join(root,name),st=await fs.lstat(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size>5*1024*1024)throw Error('Invalid file');
 if(path.dirname(await fs.realpath(file))!==await fs.realpath(root))throw Error('Invalid file location');return {file,st};
}
async function archive(source,name,bytes){
 const processed=path.join(source,'Processed');await fs.mkdir(processed,{recursive:true});
 if((await fs.lstat(processed)).isSymbolicLink())throw Error('Invalid archive');
 const input=await regular(source,name),target=path.join(processed,name);
 try{const old=await fs.readFile(target);if(!old.equals(bytes))throw Error('Archive conflict');await fs.unlink(input.file);}
 catch(e){if(e.code==='ENOENT')await fs.rename(input.file,target);else throw e;}
}
async function relay({source,target}){
 source=path.resolve(source);target=path.resolve(target);
 if(source===target)throw Error('Source and target must differ');
 await fs.mkdir(target,{recursive:true});
 if((await fs.lstat(target)).isSymbolicLink())throw Error('Invalid destination');
 const result={copied:0,archived:0,errors:0,failures:{},lastRun:new Date().toISOString()};
 const failure=stage=>{result.errors++;result.failures[stage]=(result.failures[stage]||0)+1;};
 try{
  const status=await regular(source,'.collector-status.json');if(status.st.size>8192)throw Error('Invalid collector status');
  const value=JSON.parse(await fs.readFile(status.file,'utf8'));
  if(value.version!==1||!Number.isFinite(Date.parse(value.lastRun))||!Number.isInteger(value.errors)||value.errors<0)throw Error('Invalid collector status');
  result.collector={lastRun:value.lastRun,errors:value.errors};
 }catch(e){if(e.code!=='ENOENT')failure('collector_status');}
 for(const name of (await fs.readdir(source)).filter(n=>/\.pdf$/i.test(n))){
  let stage='read';
  try{
   const {file,st}=await regular(source,name);if(Date.now()-st.mtimeMs<3000)continue;
   const bytes=await fs.readFile(file),after=await fs.stat(file);if(after.size!==st.size||after.mtimeMs!==st.mtimeMs)continue;
   if(bytes.subarray(0,16).indexOf(Buffer.from('%PDF'))<0)throw Error('Invalid PDF');
   const supplied=name.match(/^([a-f0-9]{64}) - /i),prefix=supplied?supplied[1]:digest(bytes),metaName=prefix+'.json';
   const stagedName=supplied?name:prefix+' - '+name;
   let metadata;
   if(supplied){const meta=await regular(source,metaName);if(meta.st.size>8192)throw Error('Invalid metadata');metadata=await fs.readFile(meta.file);const decoded=JSON.parse(metadata);
    if(digest(bytes)!==prefix||decoded.sha256!==prefix||decoded.version!==1)throw Error('Invalid checksum');
   }else metadata=Buffer.from(JSON.stringify({version:1,sha256:prefix,source:'manual'}));
   const processed=path.join(target,'Processed');
   try{const receipt=await regular(processed,stagedName);const done=await fs.readFile(receipt.file);if(!done.equals(bytes))throw Error('Receipt conflict');
    stage='archive';
    await archive(source,name,bytes);if(supplied)await archive(source,metaName,metadata);result.archived++;continue;
   }catch(e){if(e.code!=='ENOENT')throw e;}
   stage='delivery';
   const destination=path.join(target,stagedName);
   try{if(!(await fs.readFile(destination)).equals(bytes))throw Error('Destination conflict');}
   catch(e){if(e.code!=='ENOENT')throw e;const temporary=destination+'.part-'+crypto.randomUUID();await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,destination);result.copied++;}
   const destinationMeta=path.join(target,metaName);
   try{if(!(await fs.readFile(destinationMeta)).equals(metadata))throw Error('Metadata conflict');}
   catch(e){if(e.code!=='ENOENT')throw e;const temporary=destinationMeta+'.part-'+crypto.randomUUID();await fs.writeFile(temporary,metadata,{flag:'wx'});await fs.rename(temporary,destinationMeta);}
  }catch{failure(stage);}
 }
 await fs.writeFile(path.join(target,'.relay-status.json'),JSON.stringify(result));return result;
}
if(require.main===module){
 (async()=>{const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const result=await relay(config);console.log(JSON.stringify(result));if(result.errors)process.exitCode=1;})()
 .catch(()=>{console.error('IG folder delivery failed. Check the private relay configuration and Drive desktop.');process.exitCode=1;});
}
module.exports={relay};
