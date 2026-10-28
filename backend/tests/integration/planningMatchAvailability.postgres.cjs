// Separate TEST only. Inactive synthetic owner, loopback route harness, cleanup.
const root='/app/backend',fs=require('fs'),Module=require('module');
if(process.env.DB_NAME!=='tradetally_test')throw Error('Separate TEST database required');
if(process.env.PLANNING_CANDIDATE_DIR)for(const file of ['services/planningEntryMatches.js','services/planningLedger.js','routes/planningLifecycle.routes.js']){
 const name=root+'/src/'+file,m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(require('path').dirname(name));require.cache[name]=m;m._compile(fs.readFileSync(process.env.PLANNING_CANDIDATE_DIR+'/'+file,'utf8'),name);
}
const db=require(root+'/src/config/database'),assert=require('assert/strict'),crypto=require('crypto'),express=require(root+'/node_modules/express');
const owner=crypto.randomUUID(),account=crypto.randomUUID(),pid=crypto.randomUUID(),ids=Array.from({length:4},()=>crypto.randomUUID());let server;
(async()=>{try{
 await db.query("INSERT INTO users(id,email,username,password_hash,is_active,is_verified,tier) VALUES($1,$2,$3,'not-a-login-hash',false,false,'pro')",[owner,'synthetic-'+owner+'@example.invalid','synthetic-'+owner]);
 await db.query("INSERT INTO user_accounts(id,user_id,account_name,account_identifier,initial_balance_date,currency) VALUES($1,$2,'Synthetic','synthetic-availability',CURRENT_DATE,'USD')",[account,owner]);
 const definition=require(root+'/src/services/tradePlanning').normalize({title:'Synthetic availability',symbol:'TEST',instrument:'stock',direction:'long',accountId:account,currency:'USD',riskBudget:100,stopPrice:80,quantityStep:.01,runnerMode:'row',entries:[{key:'old',label:'Other level',price:100,riskWeight:50},{key:'level',label:'Reserved level',price:90,riskWeight:50}],exits:[{key:'take',label:'Earlier',price:110,percent:50},{key:'later',label:'Runner',price:110,percent:50}],options:{}});
 await db.query("INSERT INTO trade_plans(id,user_id,status,finalised,definition,management) VALUES($1,$2,'entered',true,$3::jsonb,$4::jsonb)",[pid,owner,JSON.stringify(definition),JSON.stringify({entry:{},exit:{later:{entryMatches:[{entryKey:'level',quantity:4}]}}})]);
 const entries=[[2,100,'2026-01-01','buy','old'],[4,90,'2026-01-02','buy','level'],[2,110,'2026-01-03','sell','take'],[4,110,'2026-01-04','sell','later']];
 for(const [i,[q,price,date,action,stage]]of entries.entries()){
  const trade=(await db.query("INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,entry_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions) VALUES($1,$2,'TEST',$3::date,$4,$5,$6,'long',0,0,'stock','USD','synthetic-availability',$7::jsonb) RETURNING *",[ids[i],owner,date,date+'T10:00:00Z',price,q,JSON.stringify([{id:ids[i],action,quantity:q,price,datetime:date+'T10:00:00Z',commission:0,fees:0}])])).rows[0];
  const fill=require(root+'/src/services/planningLedger').sourceFills(trade)[0];
  await db.query('INSERT INTO trade_plan_allocations(user_id,plan_id,trade_id,source_key,stage_key,action,quantity,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[owner,pid,trade.id,fill.key,stage,fill.action,q,JSON.stringify(fill)]);
 }
 const tradesBefore=(await db.query('SELECT * FROM trades WHERE user_id=$1 ORDER BY id',[owner])).rows;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:owner};next()});app.use('/plans',require(root+'/src/routes/planningLifecycle.routes'));app.use((e,req,res,next)=>res.status(500).json({error:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/plans/'+pid+'/exit-matches',plan=async()=>(await db.query('SELECT * FROM trade_plans WHERE id=$1',[pid])).rows[0];
 async function save(entryKey,exitKey='take',quantity=2){const current=await plan(),r=await fetch(url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({version:current.version,exitKey,matches:[{entryKey,quantity}]})});return {status:r.status,body:await r.json()};}
 const version=(await plan()).version;let r=await save('level');assert.equal(r.status,409,JSON.stringify(r.body));assert.match(r.body.error,/already matched to another exit/);assert.equal((await plan()).version,version);assert.deepEqual((await plan()).management.exit.later.entryMatches,[{entryKey:'level',quantity:4}]);
 r=await save('old');assert.equal(r.status,200,JSON.stringify(r.body));r=await save('level','later',4);assert.equal(r.status,200,JSON.stringify(r.body));
 assert.deepEqual((await db.query('SELECT * FROM trades WHERE user_id=$1 ORDER BY id',[owner])).rows,tradesBefore);
 console.log(JSON.stringify({realDatabase:true,cannotStealLaterExitUnits:true,rejectedEditRolledBack:true,remainingEntryCanBeMatched:true,ownMatchCanBeReopened:true,sourceTradesPreserved:true}));
}finally{if(server)await new Promise(r=>server.close(r));await db.query('DELETE FROM trade_plan_events WHERE user_id=$1',[owner]);await db.query('DELETE FROM trade_plans WHERE user_id=$1',[owner]);await db.query('DELETE FROM trades WHERE user_id=$1',[owner]);await db.query('DELETE FROM user_accounts WHERE user_id=$1',[owner]);await db.query('DELETE FROM users WHERE id=$1',[owner]);await db.pool.end();}})().catch(e=>{console.error(e);process.exitCode=1});
