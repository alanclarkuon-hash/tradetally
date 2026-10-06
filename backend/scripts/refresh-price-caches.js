// Administrative, explicit refresh. Back up the database before invoking.
const db=require('../src/config/database');
(async()=>{
 const arg=process.argv.find(v=>v.startsWith('--user='));
 const users=(await db.query(arg?'SELECT id FROM users WHERE id=$1':'SELECT id FROM users',[...(arg?[arg.slice(7)]:[])])).rows;
 if(users.length!==1)throw Error('Select exactly one user with --user=<id>');
 const id=await require('../src/services/priceCacheRefreshService').enqueue(users[0].id);
 console.log(JSON.stringify({queued:true,jobId:id}));await db.pool.end();
})().catch(async()=>{console.error('Price refresh could not be queued; select a valid user and check database connectivity.');await db.pool.end();process.exitCode=1});
