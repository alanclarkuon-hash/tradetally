/* Synthetic TEST-only partial order reservation check. */
const root='/app/backend',db=require(root+'/src/config/database'),express=require(root+'/node_modules/express'),assert=require('assert/strict'),crypto=require('crypto');
if(process.env.DB_NAME!=='tradetally_test')throw Error('TEST database only');
const owner=crypto.randomUUID(),acct=crypto.randomUUID(),pb=crypto.randomUUID(),id=crypto.randomUUID(),trades=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];let server;
(async()=>{try{
 await db.query("INSERT INTO users(id,email,username,password_hash,is_active,is_verified,tier) VALUES($1,$2,$3,'not-login',false,false,'pro')",[owner,'synthetic-'+owner+'@example.invalid','synthetic-'+owner]);
 await db.query("INSERT INTO user_accounts(id,user_id,account_name,account_identifier,initial_balance_date,currency) VALUES($1,$2,'Synthetic','partial-test',CURRENT_DATE,'USD')",[acct,owner]);
 await db.query("INSERT INTO playbooks(id,user_id,name) VALUES($1,$2,'Synthetic')",[pb,owner]);
 const d=require(root+'/src/services/tradePlanning').normalize({title:'Synthetic',thesis:'Synthetic',exceptionReason:'Synthetic evidence',symbol:'SYNTEST',instrument:'stock',direction:'long',accountId:acct,currency:'USD',playbookId:pb,riskBudget:100,stopPrice:90,quantityStep:1,entries:[{key:'a',label:'A',tactic:'Synthetic trigger',price:100,riskWeight:100}],exits:[{key:'x',label:'X',price:110,percent:100}]});
 await db.query("INSERT INTO trade_plans(id,user_id,playbook_id,status,finalised,definition) VALUES($1,$2,$3,'watching',true,$4::jsonb)",[id,owner,pb,JSON.stringify(d)]);
 const sources=[];
 for(const [i,q] of [2,3,5].entries()){const executions=[{id:'entry',action:'buy',quantity:q,price:100,datetime:'2026-01-01T10:00:00Z',commission:0,fees:0},{id:'exit',action:'sell',quantity:q,price:110,datetime:'2026-01-02T10:00:00Z',commission:0,fees:0}];await db.query("INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions) VALUES($1,$2,'SYNTEST','2026-01-01','2026-01-01T10:00:00Z','2026-01-02T10:00:00Z',100,110,$3,'long',0,0,'stock','USD','partial-test',$4::jsonb)",[trades[i],owner,q,JSON.stringify(executions)]);sources.push(require(root+'/src/services/planningLedger').sourceFills((await db.query('SELECT * FROM trades WHERE id=$1',[trades[i]])).rows[0]))}
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:owner};next()});const auth=require(root+'/src/middleware/auth'),original=auth.authenticate;auth.authenticate=(req,res,next)=>next();app.use('/plans',require(root+'/src/routes/tradePlanning.routes'));auth.authenticate=original;
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/plans/'+id;
 const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
 const version=async()=>(await db.query('SELECT version FROM trade_plans WHERE id=$1',[id])).rows[0].version;
 const commitment=async()=>(await db.query('SELECT * FROM trade_plan_commitments WHERE plan_id=$1',[id])).rows[0];
 const choose=(i,action)=>({tradeId:trades[i],sourceKey:sources[i][action==='entry'?0:1].key,fingerprint:sources[i][action==='entry'?0:1].fingerprint,quantity:[2,3,5][i]});
 await db.query('INSERT INTO trade_planning_settings(user_id,settings) VALUES($1,$2::jsonb)',[owner,JSON.stringify({currency:'USD'})]);
 const first=await call('/commitments','POST',{version:await version(),stageKey:'a',checks:{trigger:true,context:true,protection:true,data:true},riskOverrideReason:'Synthetic capacity verification'});assert.equal(first.status,201);
 const cid=first.data.commitment.id;
 const link=async(i,action)=>call('/allocations','POST',{version:await version(),stageKey:action==='entry'?'a':'x',action,fills:[choose(i,action)]});
 assert.equal((await link(0,'entry')).status,201);let c=await commitment();assert.equal(c.status,'reserved');assert.equal(Number(c.risk_amount),80);assert.equal(c.snapshot.reservation.remainingQuantity,8);
 const riskResponse=await fetch(base.slice(0,base.lastIndexOf('/'))+'/risk');assert.equal(riskResponse.status,200);const risk=await riskResponse.json();assert.equal(risk.accounts[0].reservedCash,800);assert.equal(risk.accounts[0].knownExposure,800);
 const before=JSON.stringify(c);assert.equal((await link(0,'entry')).status,409);assert.equal(JSON.stringify(await commitment()),before,'duplicate retry leaves remainder intact');
 assert.equal((await link(0,'exit')).status,201);
 assert.equal((await call('/review','POST',{version:await version(),notes:'Synthetic review',processFollowed:true})).status,409,'closed filled portion cannot review with a live remainder');
 assert.equal((await call('/complete','POST',{version:await version()})).status,409,'completion blocked by unresolved order');
 const later=await call('/allocations','POST',{version:await version(),stageKey:'a',action:'entry',fills:[choose(1,'entry'),choose(2,'entry')]});assert.equal(later.status,201,JSON.stringify(later.data));c=await commitment();assert.equal(c.status,'released');assert.equal(c.snapshot.reservation.remainingQuantity,0,'later fills fully replace reservation');
 assert.equal((await call('/workflow')).data.ledger.entered,10);
 // Explicit cancellation releases only a newly reserved unfilled remainder.
 const otherId=crypto.randomUUID();await db.query("INSERT INTO trade_plans(id,user_id,playbook_id,status,finalised,definition) VALUES($1,$2,$3,'watching',true,$4::jsonb)",[otherId,owner,pb,JSON.stringify(d)]);
 const otherBase=base.slice(0,base.lastIndexOf('/'))+'/'+otherId;const request=async(path,body)=>{const r=await fetch(otherBase+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
 const pending=await request('/commitments',{version:1,stageKey:'a',checks:{trigger:true,context:true,protection:true,data:true},riskOverrideReason:'Synthetic verification'});assert.equal(pending.status,201);
 const pendingId=pending.data.commitment.id;
 const extra=crypto.randomUUID();await db.query("INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions) SELECT $1,user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions FROM trades WHERE id=$2",[extra,trades[0]]);
 const extraSources=require(root+'/src/services/planningLedger').sourceFills((await db.query('SELECT * FROM trades WHERE id=$1',[extra])).rows[0]);
 const partialOther=await request('/allocations',{version:2,stageKey:'a',action:'entry',fills:[{tradeId:extra,sourceKey:extraSources[0].key,fingerprint:extraSources[0].fingerprint,quantity:2}]});assert.equal(partialOther.status,201);
 const unfilled=(await db.query('SELECT * FROM trade_plan_commitments WHERE id=$1',[pendingId])).rows[0];assert.equal(Number(unfilled.risk_amount),80);assert.equal(unfilled.snapshot.reservation.remainingQuantity,8);
 assert.equal((await request('/commitments/'+pendingId+'/release',{externalOrderNotLive:false,reason:'Synthetic cancellation'})).status,422,'cannot release without cancellation confirmation');
 assert.equal((await request('/commitments/'+pendingId+'/release',{externalOrderNotLive:true,reason:'Synthetic cancellation'})).status,200);
 assert.equal((await db.query('SELECT status FROM trade_plan_commitments WHERE id=$1',[pendingId])).rows[0].status,'released');
 const extraVersion=async()=>(await db.query('SELECT version FROM trade_plans WHERE id=$1',[otherId])).rows[0].version;
 assert.equal((await request('/allocations',{version:await extraVersion(),stageKey:'x',action:'exit',fills:[{tradeId:extra,sourceKey:extraSources[1].key,fingerprint:extraSources[1].fingerprint,quantity:2}]})).status,201);
 assert.equal((await request('/review',{version:await extraVersion(),notes:'Synthetic review after cancellation',processFollowed:true})).status,200);
 assert.equal((await request('/complete',{version:await extraVersion()})).status,200,'resolved cancellation permits review and close');
 assert.equal((await db.query('SELECT count(*)::int AS count FROM trade_plan_allocations WHERE plan_id=$1',[id])).rows[0].count,4,'release never removes linked fills');
 console.log('PASS: TEST partial 2/10 fill retains 8 units and proportional capacity; retries, later batch fills, review/close guards and confirmed cancellation');
}catch(e){console.error('FAIL: synthetic partial commitment:',e.message);process.exitCode=1}finally{if(server)await new Promise(r=>server.close(r));await db.query('DELETE FROM trade_plans WHERE user_id=$1',[owner]);await db.query('DELETE FROM users WHERE id=$1',[owner]);await db.pool.end()}})();
