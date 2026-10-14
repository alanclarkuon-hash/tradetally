// Prepare only the enabled ingestion archive, before dropping root privileges.
const fs=require('fs/promises'),path=require('path'),{constants}=require('fs');
async function prepare({enabled,root,uid,gid}) {
 if(enabled!=='true')return;
 if(!root||!Number.isInteger(uid)||!Number.isInteger(gid))throw Error('Invalid ingestion configuration');
 const base=path.resolve(root);
 if(base===path.parse(base).root)throw Error('Invalid ingestion folder');
 const st=await fs.lstat(base);
 if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(base)!==base)throw Error('Invalid ingestion folder');
 const archive=path.join(base,'Processed');
 try{await fs.mkdir(archive);}catch(e){if(e.code!=='EEXIST')throw e;}
 const entry=await fs.lstat(archive);
 if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('Invalid archive folder');
 // Operate on the opened directory, never recursively on statement files.
 const handle=await fs.open(archive,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{const current=await handle.stat();if(!current.isDirectory())throw Error('Invalid archive folder');
  await handle.chown(uid,gid);await handle.chmod((current.mode&0o777)|0o700);
 }finally{await handle.close();}
}
if(require.main===module){
 const id=flag=>Number(require('child_process').execFileSync('id',[flag,'appuser'],{encoding:'utf8'}).trim());
 (async()=>{if(process.env.ENABLE_IG_STATEMENT_INGESTER!=='true')return;
  await prepare({enabled:'true',root:process.env.IG_INGEST_FOLDER,uid:id('-u'),gid:id('-g')});
 })().catch(()=>console.error('[IG] Statement archive is unavailable. Check the private ingestion folder permissions; statements remain queued.'));
}
module.exports={prepare};
