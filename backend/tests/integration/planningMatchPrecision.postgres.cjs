// Separate TEST only: inactive synthetic owner, local route harness, cleanup in finally.
const root='/app/backend',db=require(root+'/src/config/database'),assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require(root+'/node_modules/express');
if(process.env.DB_NAME!=='tradetally_test')throw Error('Separate TEST database required');
const owner=crypto.randomUUID(),account=crypto.randomUUID(),pid=crypto.randomUUID(),ids=Array.from({length:3},()=>crypto.randomUUID());let server;
(async()=>{try{
 await db.query("INSERT INTO users(id,email,username,password_hash,is_active,is_verified,tier) VALUES($1,$2,$3,'not-a-login-hash',false,false,'pro')",[owner,'synthetic-'+owner+'@example.invalid','synthetic-'+owner]);
 await db.query("INSERT INTO user_accounts(id,user_id,account_name,account_identifier,initial_balance_date,currency) VALUES($1,$2,'Synthetic','synthetic-precision',CURRENT_DATE,'USD')",[account,owner]);
 const definition=require(root+'/src/services/tradePlanning').normalize({title:'Synthetic precision',symbol:'SYNTH',instrument:'crypto',direction:'long',accountId:account,currency:'USD',riskBudget:100,stopPrice:80,quantityStep:1e-8,runnerMode:'row',entries:[{key:'level',label:'Sold level',price:90,riskWeight:100},{key:'other',label:'Unsold level',price:85,riskWeight:0}],exits:[{key:'target',label:'Target',price:110,percent:100}],options:{}});
 await db.query("INSERT INTO trade_plans(id,user_id,status,finalised,definition) VALUES($1,$2,'entered',true,$3::jsonb)",[pid,owner,JSON.stringify(definition)]);
 for(const [i,[quantity,price,date,action,stage]] of [[17.00000001,90,'2026-01-01','buy','level'],[7.125,85,'2026-01-01','buy','other'],[17.00000002,110,'2026-01-02','sell','target']].entries()){
  const trade=(await db.query("INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,entry_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions) VALUES($1,$2,'SYNTH',$3::date,$4,$5,$6,'long',0,0,'crypto','USD','synthetic-precision',$7::jsonb) RETURNING *",[ids[i],owner,date,date+'T10:00:00Z',price,quantity,JSON.stringify([{id:ids[i],action,quantity,price,datetime:date+'T10:00:00Z',commission:0,fees:0}])])).rows[0];
  const fill=require(root+'/src/services/planningLedger').sourceFills(trade)[0];
  await db.query('INSERT INTO trade_plan_allocations(plan_id,user_id,trade_id,source_key,stage_key,action,quantity,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[pid,owner,trade.id,fill.key,stage,fill.action,fill.quantity,JSON.stringify(fill)]);
 }
 const before=(await db.query('SELECT * FROM trades WHERE user_id=$1 ORDER BY id',[owner])).rows;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:owner};next()});app.use('/plans',require(root+'/src/routes/planningLifecycle.routes'));app.use((e,req,res,next)=>res.status(500).json({error:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port+'/plans/'+pid,plan=async()=>(await db.query('SELECT * FROM trade_plans WHERE id=$1',[pid])).rows[0];
 async function save(entryKey,quantity,version=(undefined)){const p=await plan();const res=await fetch(base+'/exit-matches',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({version:version??p.version,exitKey:'target',matches:[{entryKey,quantity}]})});return {status:res.status,body:await res.json()};}
 let r=await save('level',17.00000002);assert.equal(r.status,200,JSON.stringify(r.body));
 let workflow=await (await fetch(base+'/workflow')).json();assert.equal(workflow.ledger.matchingUnresolved,0);assert.ok(Number.isFinite(workflow.ledger.realisedProfit));assert.ok(workflow.ledger.openLots.some(l=>l.stageKey==='other'&&l.q===7.125));
 const savedVersion=(await plan()).version;
 r=await save('level',17.00000004);assert.equal(r.status,409);assert.equal((await plan()).version,savedVersion);
 r=await save('other',17.00000002);assert.equal(r.status,409);assert.equal((await plan()).version,savedVersion);
 r=await save('level',17.00000001,savedVersion-1);assert.equal(r.status,409);
 r=await save('level',17.00000001);assert.equal(r.status,200,JSON.stringify(r.body));workflow=await (await fetch(base+'/workflow')).json();assert.equal(workflow.ledger.matchingUnresolved,0);
 assert.deepEqual((await db.query('SELECT * FROM trades WHERE user_id=$1 ORDER BY id',[owner])).rows,before);
 assert.deepEqual((await plan()).definition,definition);
 console.log(JSON.stringify({realDatabase:true,precisionBoundarySaved:true,capacityBoundarySaved:true,realShortageRejected:true,staleVersionRejected:true,unsoldEntryPreserved:true,sourceTradesPreserved:true}));
}finally{if(server)await new Promise(r=>server.close(r));for(const table of ['trade_plan_events','trade_plan_allocations','trade_plans','trades','user_accounts'])await db.query('DELETE FROM '+table+' WHERE user_id=$1',[owner]);await db.query('DELETE FROM users WHERE id=$1',[owner]);await db.pool.end();}})().catch(e=>{console.error(e);process.exitCode=1});
