// Restore only to this fixed disposable database. Never target the live database.
const fs=require('node:fs');const fsp=fs.promises;const path=require('node:path');
const {decrypt,command,digest}=require('./backup-offsite.cjs');
const ROOT=path.resolve(__dirname,'..');
const {productionPaths,productionCompose}=require('./private-storage.cjs');
const paths=productionPaths(ROOT),BASE=paths.staging;
const DATABASE='tradetally_offsite_restore_check';
async function main(){
  const input=process.argv[2];if(!input||path.extname(input)!=='.ttbackup')throw Error('Choose an encrypted backup');
  const key=Buffer.from((await fsp.readFile(path.join(paths.secrets,'recovery.key'),'utf8')).trim(),'hex');
  const work=await fsp.mkdtemp(path.join(BASE,'verify-'));let created=false;
  const compose=[...productionCompose(ROOT,paths),'exec','-T','postgres','sh','-c'];
  try{
    const archive=path.join(work,'backup.tar.gz');await decrypt(input,archive,key);
    await command('tar',['-xzf',archive,'-C',work,'database.dump','retained-files.tar.gz','manifest.json']);
    const manifest=JSON.parse(await fsp.readFile(path.join(work,'manifest.json'),'utf8'));
    for(const file of ['database.dump','retained-files.tar.gz'])if(await digest(path.join(work,file))!==manifest.files[file])throw Error('Backup manifest mismatch');
    await command('docker',[...compose,`exec createdb -U "$POSTGRES_USER" ${DATABASE}`]);created=true;
    await command('docker',[...compose,`exec pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d ${DATABASE}`],null,path.join(work,'database.dump'));
    // Verify the restored account/trade tables are populated; no row contents leave the database.
    const summary=path.join(work,'summary.txt');
    await command('docker',[...compose,`exec psql -U "$POSTGRES_USER" -d ${DATABASE} -Atc 'SELECT (SELECT count(*) FROM users),(SELECT count(*) FROM trades),(SELECT count(*) FROM broker_cash_events)'`],summary);
    const counts=(await fsp.readFile(summary,'utf8')).trim().split('|').map(Number);
    if(counts.length!==3||counts.some(n=>!Number.isSafeInteger(n)||n<1))throw Error('Restored database verification failed');
    console.log(JSON.stringify({restoreVerified:true,users:counts[0],trades:counts[1],cashEvents:counts[2]}));
  }finally{
    if(created)await command('docker',[...compose,`exec dropdb -U "$POSTGRES_USER" ${DATABASE}`]);
    if(path.dirname(work)!==BASE)throw Error('Unsafe verification directory');await fsp.rm(work,{recursive:true,force:true});
  }
}
main().catch(()=>{console.error('Restore verification failed; the live database was not targeted.');process.exitCode=1;});
