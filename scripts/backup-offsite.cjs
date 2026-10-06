// Private data and recovery keys stay outside the repository.
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
const ROOT=path.resolve(__dirname,'..');
const PRIVATE=path.join(ROOT,'.local','backup-secrets');
const OUTPUT=path.join(ROOT,'.local','backup-output');
const STAGING=path.join(ROOT,'.local','backup-staging');
const HEADER=Buffer.from('TTBK0001');
async function command(exe,args,file,stdin){
  const child=spawn(exe,args,{cwd:ROOT,env:{...process.env,TRADETALLY_PRODUCTION_ENV_FILE:paths.env},windowsHide:true,stdio:['pipe','pipe','pipe']});
  const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${exe} failed (${code})`)));});
  // Do not print private command output or pg_dump diagnostics into public logs.
  child.stderr.resume();
  const io=[];if(file)io.push(pipeline(child.stdout,fs.createWriteStream(file)));else child.stdout.resume();
  if(stdin)io.push(pipeline(fs.createReadStream(stdin),child.stdin));else child.stdin.end();
  await Promise.all([completion,...io]);
}
async function encrypt(source,destination,key){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  await fsp.writeFile(destination,Buffer.concat([HEADER,iv]),{flag:'wx'});
  await pipeline(fs.createReadStream(source),cipher,fs.createWriteStream(destination,{flags:'a'}));
  await fsp.appendFile(destination,cipher.getAuthTag());
}
async function decrypt(source,destination,key){
  const h=await fsp.open(source,'r');let size,head,tag;
  try{size=(await h.stat()).size;if(size<36)throw Error('Invalid backup');head=Buffer.alloc(20);tag=Buffer.alloc(16);await h.read(head,0,20,0);await h.read(tag,0,16,size-16);}finally{await h.close();}
  if(!head.subarray(0,8).equals(HEADER))throw Error('Invalid backup format');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,head.subarray(8));decipher.setAuthTag(tag);
  try{await pipeline(fs.createReadStream(source,{start:20,end:size-17}),decipher,fs.createWriteStream(destination,{flags:'wx'}));}catch(e){await fsp.rm(destination,{force:true});throw e;}
}
async function digest(file){const hash=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))hash.update(b);return hash.digest('hex');}
async function main(){
  for(const d of [PRIVATE,OUTPUT,STAGING])await fsp.mkdir(d,{recursive:true});
  const lock=path.join(PRIVATE,'backup.lock');let handle;
  try{handle=await fsp.open(lock,'wx');}catch{throw Error('Another backup is active or its lock needs review');}
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const work=await fsp.mkdtemp(path.join(STAGING,'run-'));
  let encrypted;
  try{
    const keyFile=path.join(PRIVATE,'recovery.key');
    if(!fs.existsSync(keyFile))await fsp.writeFile(keyFile,crypto.randomBytes(32).toString('hex'),{flag:'wx'});
    const key=Buffer.from((await fsp.readFile(keyFile,'utf8')).trim(),'hex');if(key.length!==32)throw Error('Invalid recovery key');
    const compose=[...productionCompose(ROOT,paths),'exec','-T'];
    await command('docker',[...compose,'postgres','sh','-c','exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"'],path.join(work,'database.dump'));
    await command('docker',[...compose,'app','tar','-czf','-','--exclude=backend/src/data/backups','--exclude=backend/src/data/logs','-C','/app','backend/uploads','backend/src/data'],path.join(work,'retained-files.tar.gz'));
    await fsp.copyFile(paths.env,path.join(work,'environment.env'));
    await fsp.copyFile(path.join(ROOT,'compose.local.yaml'),path.join(work,'compose.local.yaml'));
    const hashes={};for(const name of ['database.dump','retained-files.tar.gz','environment.env','compose.local.yaml'])hashes[name]=await digest(path.join(work,name));
    await fsp.writeFile(path.join(work,'manifest.json'),JSON.stringify({format:1,createdAt:new Date().toISOString(),databaseFormat:'PostgreSQL custom dump',files:hashes,notes:'Database snapshot is consistent. Retained files are copied while the app runs. Recovery key is stored separately.'},null,2));
    const archive=path.join(work,'backup.tar.gz');
    await command('tar',['-czf',archive,'-C',work,'database.dump','retained-files.tar.gz','environment.env','compose.local.yaml','manifest.json']);
    encrypted=path.join(OUTPUT,`tradetally-${stamp}.ttbackup`);await encrypt(archive,encrypted,key);
    const verified=path.join(work,'verified.tar.gz');await decrypt(encrypted,verified,key);
    if(await digest(archive)!==await digest(verified))throw Error('Backup verification failed');
    const destination=process.argv.find(a=>a.startsWith('--destination='))?.slice(14);
    if(destination){
      const stat=await fsp.stat(destination);if(!stat.isDirectory())throw Error('Drive destination is unavailable');
      const target=path.join(destination,path.basename(encrypted));
      await fsp.copyFile(encrypted,target,fs.constants.COPYFILE_EXCL);
      if(await digest(target)!==await digest(encrypted))throw Error('Drive copy verification failed');
      // Retention is confined to backup files created by this workflow.
      const names=(await fsp.readdir(destination)).filter(n=>/^tradetally-\d{4}-\d\d-\d\dT[\dTZ-]+\.ttbackup$/.test(n)).sort().reverse();
      for(const name of names.slice(30))await fsp.unlink(path.join(destination,name));
    }
    await fsp.writeFile(path.join(PRIVATE,'last-success.json'),JSON.stringify({createdAt:new Date().toISOString(),file:path.basename(encrypted),bytes:(await fsp.stat(encrypted)).size,sha256:await digest(encrypted),copiedToDrive:Boolean(destination),cloudUploadVerified:false}));
    console.log(JSON.stringify({success:true,file:path.basename(encrypted),bytes:(await fsp.stat(encrypted)).size,copiedToDrive:Boolean(destination)}));
  }finally{
    // work is generated below the fixed private staging root, never user input.
    if(path.dirname(work)!==STAGING)throw Error('Unsafe temporary directory');
    await fsp.rm(work,{recursive:true,force:true});await handle.close();await fsp.unlink(lock);
  }
}
module.exports={encrypt,decrypt,digest,command};
if(require.main===module)main().catch(()=>{console.error('Backup failed. Review the Docker connection, recovery key and Drive availability. Existing backups are retained.');process.exitCode=1;});
