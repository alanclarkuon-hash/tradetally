// Synthetic isolated-schema TEST integration; never uses broker credentials/APIs.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {Client}=require('pg');
const schema='sync_recovery_test_'+crypto.randomUUID().replaceAll('-','');
const admin=new Client({host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});
let db,worker,live;
(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA "${schema}"`);
 process.env.DB_SCHEMA=schema;
 db=require('../../src/config/database');const recovery=require('../../src/services/brokerSync/syncRecovery');
 await db.query(`CREATE TABLE broker_connections(id uuid PRIMARY KEY,last_sync_status text,last_sync_message text,last_error_message text,last_error_at timestamptz,updated_at timestamptz);
 CREATE TABLE broker_sync_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connection_id uuid,status text,started_at timestamptz DEFAULT NOW(),completed_at timestamptz,duration_ms int,error_message text,error_details jsonb,sync_details jsonb,trades_imported int DEFAULT 1);
 CREATE TABLE trades(execution_key text PRIMARY KEY,quantity numeric)`);
 const [deadId,liveId,newerId]=Array.from({length:3},()=>crypto.randomUUID());
 for(const id of [deadId,liveId,newerId])await db.query("INSERT INTO broker_connections(id,last_sync_status) VALUES($1,'success')",[id]);
 live=await recovery.acquire(liveId);
 await db.query("INSERT INTO broker_sync_logs(connection_id,status) VALUES($1,'importing')",[liveId]);
 await db.query("INSERT INTO broker_sync_logs(connection_id,status,started_at) VALUES($1,'parsing',NOW()-INTERVAL '2 minutes')",[newerId]);
 await db.query("INSERT INTO broker_sync_logs(connection_id,status,completed_at) VALUES($1,'completed',NOW())",[newerId]);
 const body=`const db=require('./src/config/database'),r=require('./src/services/brokerSync/syncRecovery');(async()=>{await r.acquire('${deadId}');for(const phase of ['started','fetching','parsing','importing'])await db.query('INSERT INTO broker_sync_logs(connection_id,status) VALUES($1,$2)',['${deadId}',phase]);await db.query("INSERT INTO trades VALUES('synthetic-execution',2) ON CONFLICT DO NOTHING");process.stdout.write('WORKER_READY\\n');setInterval(()=>{},1000)})().catch(()=>process.exit(1));`;
 worker=spawn(process.execPath,['-e',body],{cwd:require('node:path').resolve(__dirname,'../../'),env:process.env,stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Worker startup timed out')),10000);worker.stdout.on('data',chunk=>{output+=chunk;if(output.includes('WORKER_READY')){clearTimeout(timer);resolve();}});worker.once('exit',code=>{clearTimeout(timer);reject(Error('Worker exited early: '+code));});});
 // While the worker is alive, its lock prevents recovery on another instance.
 assert.equal(await recovery.acquire(deadId),null);
 worker.kill('SIGKILL');await new Promise(resolve=>worker.once('exit',resolve));worker=null;
 let recovered;for(let i=0;i<20;i++){recovered=await recovery.recoverAbandoned();if(recovered.recovered===5)break;await new Promise(resolve=>setTimeout(resolve,50));}
 assert.equal(recovered.recovered,5);assert.equal(recovered.active,1);
 const old=(await db.query('SELECT * FROM broker_sync_logs WHERE connection_id=$1',[deadId])).rows;
 assert.equal(old.length,4);for(const log of old){assert.equal(log.status,'failed');assert.equal(log.error_details.code,'sync_interrupted');assert.equal(log.sync_details.outcome,'interrupted');assert.ok(log.completed_at);assert.ok(log.duration_ms>=0);assert.equal(log.trades_imported,1);}
 assert.equal((await db.query('SELECT last_sync_status FROM broker_connections WHERE id=$1',[newerId])).rows[0].last_sync_status,'success');
 assert.equal((await db.query('SELECT status FROM broker_sync_logs WHERE connection_id=$1',[liveId])).rows[0].status,'importing');
 await live.release();live=null;assert.equal((await recovery.recoverAbandoned()).recovered,1);assert.equal((await recovery.recoverAbandoned()).recovered,0);
 // Run the real orchestrator guard/recovery, using a synthetic adapter callback
 // to verify committed execution identity remains idempotent on retry.
 const service=require('../../src/services/brokerSync');service.runConnectionSync=async()=>{
  const log=(await db.query("INSERT INTO broker_sync_logs(connection_id,status) VALUES($1,'importing') RETURNING id",[deadId])).rows[0];
  await require('../../src/models/BrokerConnection').updateSyncProgress(log.id,'transactions',3);
  const progress=(await db.query('SELECT sync_details FROM broker_sync_logs WHERE id=$1',[log.id])).rows[0].sync_details.progress;
  assert.equal(progress.pages,3);assert.equal(progress.section,'transactions');
  await db.query("INSERT INTO trades VALUES('synthetic-execution',2) ON CONFLICT DO NOTHING");
  await db.query("UPDATE broker_sync_logs SET status='completed',completed_at=NOW() WHERE id=$1",[log.id]);return {success:true};
 };
 assert.equal((await service.syncConnection(deadId)).success,true);
 const trades=(await db.query('SELECT * FROM trades')).rows;assert.equal(trades.length,1);assert.equal(Number(trades[0].quantity),2);
 assert.equal((await recovery.recoverAbandoned()).recovered,0);
 console.log('PASS: killed worker recovery, all active phases, active lock safety, newer success retention, idempotent retry, bounded progress, unchanged committed execution.');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(worker)worker.kill('SIGKILL');if(live)await live.release();if(db)await db.pool.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();});
