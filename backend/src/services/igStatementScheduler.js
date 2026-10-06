let timer,running=false;const state={lastRun:null,error:null,pending:0};
async function run(){
 if(running)return;running=true;state.error=null;
 try{
  const userId=process.env.IG_INGEST_USER_ID,root=process.env.IG_INGEST_FOLDER;
  if(!userId||!root)throw Error('not_configured');
  const source=require('./igStatementSource').folderSource(root),files=await source.list();state.pending=files.length;
  if(process.env.IG_INGEST_REQUIRE_RELAY==='true'){
   const delivery=await source.deliveryHealth();
   if(!delivery||delivery.errors||!Number.isFinite(Date.parse(delivery.lastRun))||Date.now()-Date.parse(delivery.lastRun)>5*60000)
    state.error='Drive folder delivery needs attention. Check Drive desktop and the host ingestion task.';
   else if(delivery.collector&&(delivery.collector.errors||!Number.isFinite(Date.parse(delivery.collector.lastRun))||Date.now()-Date.parse(delivery.collector.lastRun)>60*60000))
    state.error='Gmail statement collection needs attention. Check the collector execution log and pending emails.';
  }
  let backupPromise;
  const backup=()=>backupPromise||(backupPromise=require('./backup.service').createFullSiteBackup(userId));
  let attempted=0;
  for(const name of files){
   if(attempted>=20)break;
   try{
    const item=await source.read(name);if(!item)continue;
    const result=await require('./brokerSync/igStatementIngester').ingest(userId,item.buffer,{filename:item.filename,statementDate:item.metadata?.statementDate,backup});
    if(!result.skipped)attempted++;
    if(['imported','duplicate'].includes(result.status)){await source.acknowledge(name);state.pending--;}
   }catch{state.error='A statement file could not be read or archived. Check the private ingestion folder.';}
  }
  try{
   const reconciliation=await require('./brokerSync/igAutomaticReconciliation').run(userId,{backup});
   if(reconciliation.maintenanceFailed)state.error='IG portfolio maintenance needs a retry; it will retry automatically on the next folder check.';
  }catch{state.error='Automatic IG reconciliation could not finish. It will retry on the next folder check; review the statement results.';}
  state.lastRun=new Date().toISOString();
 }catch{state.error='The IG ingestion folder is unavailable or not configured.';}
 finally{running=false;}
}
function start(){if(timer)return;run();timer=setInterval(run,60000);timer.unref();}
function stop(){clearInterval(timer);timer=null;}
function status(){return {...state,running};}
module.exports={start,stop,run,status};
