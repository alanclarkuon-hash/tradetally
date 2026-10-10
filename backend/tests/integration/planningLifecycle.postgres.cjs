
/* Opt-in TEST-only integration check. Uses temporary synthetic records and removes them in finally. */
const root=process.env.PLANNING_BACKEND_ROOT||'/app/backend';
const db=require(root+'/src/config/database'),express=require(root+'/node_modules/express'),crypto=require('crypto'),assert=require('assert/strict');
if(process.env.DB_NAME!=='tradetally_test')throw new Error('This check is restricted to the separate TEST database');
const owner=crypto.randomUUID(),account=crypto.randomUUID(),pb=crypto.randomUUID(),planId=crypto.randomUUID(),tradeId=crypto.randomUUID();
let server;
const d={title:'Synthetic integration',symbol:'SYNTEST',assetName:'Synthetic',instrument:'stock',direction:'long',accountId:account,currency:'USD',playbookId:pb,riskBudget:100,stopPrice:90,quantityStep:1,pointSize:1,thesis:'Synthetic',chartUrl:'',runnerMode:'row',runnerRule:'Trail',runnerEstimatePrice:null,exceptionReason:'Synthetic evidence',preparation:[],entries:[{key:'a',label:'Entry',price:100,riskWeight:100,tactic:'Condition'}],exits:[{key:'b',label:'Partial',price:110,percent:50},{key:'runner',label:'Runner',price:120,percent:50}],options:{}};
const executions=[{id:'a',action:'buy',quantity:10,price:100,datetime:'2026-01-01T10:00:00Z',commission:2,fees:0},{id:'b',action:'sell',quantity:5,price:110,datetime:'2026-01-02T10:00:00Z',commission:1,fees:0},{id:'c',action:'sell',quantity:5,price:120,datetime:'2026-01-03T10:00:00Z',commission:1,fees:0}];
(async()=>{
 try{
  await db.query("INSERT INTO users(id,email,username,password_hash,is_active,is_verified,tier) VALUES($1,$2,$3,$4,false,false,'pro')",[owner,'planning-'+owner+'@example.invalid','planning-'+owner,'not-a-login-hash']);
  await db.query("INSERT INTO user_accounts(id,user_id,account_name,account_identifier,initial_balance_date,currency) VALUES($1,$2,'Synthetic','synthetic',CURRENT_DATE,'USD')",[account,owner]);
  await db.query("INSERT INTO playbooks(id,user_id,name) VALUES($1,$2,'Synthetic')",[pb,owner]);
  const normalized=require(root+'/src/services/tradePlanning').normalize(d);
  await db.query("INSERT INTO trade_plans(id,user_id,playbook_id,status,finalised,definition) VALUES($1,$2,$3,'draft',false,$4::jsonb)",[planId,owner,pb,JSON.stringify(normalized)]);
  await db.query("INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions) VALUES($1,$2,$3,'2026-01-01','2026-01-01T10:00:00Z','2026-01-03T10:00:00Z',100,115,10,'long',4,0,'stock','USD','synthetic',$4::jsonb)",[tradeId,owner,d.symbol,JSON.stringify(executions)]);
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:owner};next()});const auth=require(root+'/src/middleware/auth'),originalAuthenticate=auth.authenticate;auth.authenticate=(req,res,next)=>next();app.use('/plans',require(root+'/src/routes/tradePlanning.routes'));auth.authenticate=originalAuthenticate;app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/plans/'+planId;
  async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
  async function version(){return (await db.query('SELECT version FROM trade_plans WHERE id=$1',[planId])).rows[0].version}
  assert.equal((await call('/finalisation','POST',{version:await version(),finalised:true})).status,200,'finalisation validates and persists');
  assert.equal((await db.query('SELECT status,finalised FROM trade_plans WHERE id=$1',[planId])).rows[0].status,'draft','finalisation does not move the lifecycle stage');
  assert.equal((await call('','PUT',{version:await version(),definition:{...normalized,riskBudget:200}})).status,422,'finalised preparation is read-only');
  assert.equal((await call('/finalisation','POST',{version:await version(),finalised:false})).status,200,'finalisation can be removed');
  assert.equal((await call('/status','POST',{version:await version(),status:'watching'})).status,422,'unfinished plan cannot move to Watching');
  assert.equal((await call('/finalisation','POST',{version:await version(),finalised:true})).status,200);
  assert.equal((await call('/status','POST',{version:await version(),status:'watching'})).status,200,'Draft moves directly to Watching');
  assert.equal((await db.query('SELECT finalised FROM trade_plans WHERE id=$1',[planId])).rows[0].finalised,true,'Watching retains preparation evidence');
  const mistakenEntry={executed:true,units:1,price:100,time:'2026-01-01T10:00:00Z'};
  assert.equal((await call('/management','PUT',{version:await version(),management:{entry:{a:mistakenEntry},exit:{}}})).status,200);
  assert.equal((await db.query('SELECT status FROM trade_plans WHERE id=$1',[planId])).rows[0].status,'entered');
  assert.equal((await call('/management','PUT',{version:await version(),management:{entry:{a:{...mistakenEntry,executed:false}},exit:{}}})).status,200);
  const resetPlan=(await db.query('SELECT status,baseline FROM trade_plans WHERE id=$1',[planId])).rows[0];assert.equal(resetPlan.status,'watching','last mistaken mark returns to Watching');assert.equal(resetPlan.baseline,null,'mistaken provisional baseline is cleared');
  const automaticRow={executed:false,units:null,price:100,time:'2026-01-01T10:00:00Z'};
  assert.equal((await call('/management','PUT',{version:await version(),management:{entry:{a:automaticRow},exit:{}}})).status,200,'automatic unexecuted sizing is accepted');
  assert.equal((await db.query('SELECT management FROM trade_plans WHERE id=$1',[planId])).rows[0].management.entry.a.units,null,'automatic sizing persists instead of a zero override');
  const automaticVersion=await version();
  assert.equal((await call('/management','PUT',{version:automaticVersion,management:{entry:{a:automaticRow},exit:{}}})).status,200);
  assert.equal(await version(),automaticVersion,'unchanged automatic sizing creates no update');

  for(const [instrument,scope,side] of [['cfd','synthetic','long'],['stock','other-synthetic','long'],['stock','synthetic','short']]){
   await db.query("INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,entry_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier) VALUES($1,$2,$3,'2026-01-01','2026-01-01T10:00:00Z',100,10,$4,0,0,$5,'USD',$6)",[crypto.randomUUID(),owner,d.symbol,side,instrument,scope]);
  }
  const candidates=(await call('/fills')).data.fills;
  assert(candidates.length===3&&candidates.every(f=>f.tradeId===tradeId),'finder excludes mismatched CFD, account and direction');
  const t=(await db.query('SELECT * FROM trades WHERE id=$1',[tradeId])).rows[0],fills=require(root+'/src/services/planningLedger').sourceFills(t);
  async function link(index,stage){const f=fills[index];return call('/allocations','POST',{version:await version(),tradeId,sourceKey:f.key,fingerprint:f.fingerprint,stageKey:stage,action:f.action,quantity:f.quantity})}
  assert.equal((await link(0,'a')).status,201,'entry allocation');
  assert.equal((await link(0,'a')).status,409,'duplicate allocation');
  assert.equal((await call('/management','PUT',{version:await version(),management:{entry:{a:automaticRow},exit:{}}})).status,200);
  assert.equal((await db.query('SELECT status FROM trade_plans WHERE id=$1',[planId])).rows[0].status,'entered','linked entries prevent reversal to Watching');
  const fxService=require(root+'/src/services/planningFx'),realFx=fxService.latestPlanningFx;
  const beforeFx=(await db.query('SELECT definition,management FROM trade_plans WHERE id=$1',[planId])).rows[0];
  fxService.latestPlanningFx=async()=>({rates:{USD:1,GBP:.8},source:'synthetic_quote'});
  try{
   const fxDefinition={...normalized,currency:'GBP',stopPrice:72,riskBudget:80,entries:[{...normalized.entries[0],price:80},{key:'extra',label:'Extra',price:88,riskWeight:0,units:2,tactic:'Condition',marketContext:[],tactics:[]}]};
   await db.query('UPDATE trade_plans SET definition=$1::jsonb WHERE id=$2',[JSON.stringify(fxDefinition),planId]);
   assert.equal((await call('/management','PUT',{version:await version(),management:{entry:{...beforeFx.management.entry,a:{...beforeFx.management.entry.a,units:10,price:80},extra:{executed:true,units:2,price:88,time:'2026-01-02T00:00:00Z'}},exit:{}}})).status,200,'mixed-currency provisional entry');
   const fxWorkflow=(await call('/workflow')).data;
   assert.equal(fxWorkflow.ledger.currency,'USD');assert.equal(fxWorkflow.ledger.positionValue,1220);assert.equal(fxWorkflow.ledger.capitalRisk,140);assert.equal(fxWorkflow.ledger.fxEstimated,true);assert.equal(fxWorkflow.ledger.coverageComplete,false);
   assert.equal((await db.query('SELECT management FROM trade_plans WHERE id=$1',[planId])).rows[0].management.entry.extra.price,88,'original provisional GBP price retained');
  }finally{fxService.latestPlanningFx=realFx;await db.query('UPDATE trade_plans SET definition=$1::jsonb,management=$2::jsonb WHERE id=$3',[JSON.stringify(beforeFx.definition),JSON.stringify(beforeFx.management),planId]);}
  assert.equal((await call('/stop','POST',{version:1,stopPrice:95,reason:'Synthetic stop test'})).status,409,'stale edit');
  assert.equal((await call('/stop','POST',{version:await version(),stopPrice:95,reason:'Synthetic stop test'})).status,200,'persisted stop');
  assert.equal((await link(1,'b')).status,201,'partial exit');
  assert.equal((await call('/workflow')).data.ledger.openQuantity,5,'remaining position');
  assert.equal((await call('/review','POST',{version:await version(),notes:'Synthetic review',processFollowed:true})).status,422,'open review blocked');
  assert.equal((await call('/review-draft','PUT',{version:await version(),notes:'Synthetic unfinished review',entryAssessment:'Synthetic entry',exitAssessment:'Synthetic exit',processFollowed:true})).status,200,'review draft persistence');
  assert.equal((await call('/workflow')).data.reviewDraft.notes,'Synthetic unfinished review');
  assert.equal((await link(2,'runner')).status,201,'final exit');
  const calendarResponse=await fetch(base.slice(0,base.lastIndexOf('/'))+'/calendar?year=2026');
  const calendar=await calendarResponse.json();assert.equal(calendarResponse.status,200,'calendar activity');
  assert(calendar.events.some(e=>e.plan_id===planId&&e.event_type==='trade_linked'&&e.action==='entry'&&e.created_at.startsWith('2026-01-01')),'calendar uses actual execution date');

  const w=(await call('/workflow')).data;assert(w.ledger.records.some(r=>r.stage_key==='runner'&&r.action==='exit'),'runner source fill retained');assert.equal(w.ledger.realisedProfit,146);assert.equal(w.ledger.realisedR,1.46);assert(w.history.some(e=>e.event_type==='stop_changed'&&e.snapshot.reason==='Synthetic stop test'));
  assert.equal((await call('/review','POST',{version:await version(),notes:'Synthetic completed review',entryAssessment:'Synthetic',exitAssessment:'Synthetic',processFollowed:true})).status,200,'review persistence');
  assert.equal((await call('/complete','POST',{version:await version()})).status,200,'plan completion');
  executions[0].price=101;await db.query('UPDATE trades SET executions=$1::jsonb WHERE id=$2',[JSON.stringify(executions),tradeId]);
  assert.equal((await call('/workflow')).data.needsUpdate,true,'correction requires review update');

  // Legacy multiple-trade row links are removed atomically; source trades stay intact.
  const unlinkPlan=crypto.randomUUID(),unlinkTrades=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  await db.query("INSERT INTO trade_plans(id,user_id,playbook_id,status,finalised,definition,baseline,management) VALUES($1,$2,$3,'entered',true,$4::jsonb,$4::jsonb,$5::jsonb)",[unlinkPlan,owner,pb,JSON.stringify(normalized),JSON.stringify({entry:{a:{executed:true,units:2,price:100,time:'2026-01-01T10:00:00Z'}}})]);
  const unlinkSource=[];
  for(let i=0;i<3;i++){const exec={id:'synthetic-'+i,action:i===2?'sell':'buy',quantity:1,price:i===2?110:100,datetime:i===2?'2026-01-02T10:00:00Z':'2026-01-01T10:00:00Z',commission:0,fees:0};await db.query("INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,entry_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions) VALUES($1,$2,$3,'2026-01-01','2026-01-01T10:00:00Z',100,1,'long',0,0,'stock','USD','synthetic',$4::jsonb)",[unlinkTrades[i],owner,d.symbol,JSON.stringify([exec])]);const t=(await db.query('SELECT * FROM trades WHERE id=$1',[unlinkTrades[i]])).rows[0];unlinkSource.push(require(root+'/src/services/planningLedger').sourceFills(t)[0]);if(i<2)await db.query("INSERT INTO trade_plan_allocations(user_id,plan_id,trade_id,source_key,stage_key,action,quantity,source_snapshot) VALUES($1,$2,$3,$4,'a','entry',1,$5::jsonb)",[owner,unlinkPlan,unlinkTrades[i],unlinkSource[i].key,JSON.stringify(unlinkSource[i])]);}
  const unlinkBase=base.slice(0,base.lastIndexOf('/'))+'/'+unlinkPlan;
  const unlinkVersion=async()=>(await db.query('SELECT version FROM trade_plans WHERE id=$1',[unlinkPlan])).rows[0].version;
  async function unlinkCall(path,method,body){const r=await fetch(unlinkBase+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
  assert.equal((await unlinkCall('/row-allocations','DELETE',{version:await unlinkVersion(),stageKey:'a',action:'entry'})).status,200);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM trade_plan_allocations WHERE plan_id=$1',[unlinkPlan])).rows[0].n,0,'all legacy links on one row removed');
  const unlinked=(await db.query('SELECT status,management,baseline FROM trade_plans WHERE id=$1',[unlinkPlan])).rows[0];assert.equal(unlinked.status,'watching');assert.equal(unlinked.management.entry.a.executed,false);assert.equal(unlinked.baseline,null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM trades WHERE id=ANY($1::uuid[])',[unlinkTrades])).rows[0].n,3,'broker trades retained');
  const linkRow=async(i,stage)=>unlinkCall('/allocations','POST',{version:await unlinkVersion(),tradeId:unlinkTrades[i],sourceKey:unlinkSource[i].key,fingerprint:unlinkSource[i].fingerprint,stageKey:stage,action:unlinkSource[i].action,quantity:1});
  assert.equal((await linkRow(0,'a')).status,201,'row can be relinked');assert.equal((await linkRow(1,'a')).status,409,'cannot add another distinct trade to the linked row');
  assert.equal((await linkRow(2,'b')).status,201,'exit linked');
  assert.equal((await unlinkCall('/row-allocations','DELETE',{version:await unlinkVersion(),stageKey:'b',action:'exit'})).status,200,'exit row unlinks separately');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM trade_plan_allocations WHERE plan_id=$1',[unlinkPlan])).rows[0].n,1,'entry link retained when exit is removed');
  console.log('PASS: TEST atomic row unlink, source trades retained, relink, duplicate-row guard and exit unlink');

  const op=crypto.randomUUID(),ot=crypto.randomUUID(),nt=crypto.randomUUID();
  const od={...d,instrument:'option',entries:[{key:'a',label:'Entry',price:100,riskWeight:100,tactic:'Condition'}],exits:[{key:'b',label:'Final',price:110,percent:100}],quantityStep:1,options:{contract:'SYNTH_OLD',type:'call',strike:100,expiry:'2026-12-18',premium:2,multiplier:100,contractDelta:50,atr:1,atrMultiplier:2}};
  await db.query("INSERT INTO trade_plans(id,user_id,playbook_id,status,finalised,definition) VALUES($1,$2,$3,'watching',true,$4::jsonb)",[op,owner,pb,JSON.stringify(require(root+'/src/services/tradePlanning').normalize(od))]);
  const oldFills=[{id:'oa',action:'buy',quantity:2,price:2,datetime:'2026-01-01T10:00:00Z',commission:1,fees:0},{id:'ob',action:'sell',quantity:2,price:4,datetime:'2026-01-02T10:00:00Z',commission:1,fees:0}];
  const newFills=[{id:'na',action:'buy',quantity:2,price:3,datetime:'2026-01-02T10:01:00Z',commission:1,fees:0},{id:'nb',action:'sell',quantity:2,price:3.5,datetime:'2026-01-03T10:00:00Z',commission:1,fees:0}];
  for(const [id,symbol,strike,expiry,execs] of [[ot,'SYNTH_OLD',100,'2026-12-18',oldFills],[nt,'SYNTH_NEW',110,'2027-01-15',newFills]]){
   await db.query("INSERT INTO trades(id,user_id,symbol,underlying_symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions,contract_size,strike_price,expiration_date,option_type) VALUES($1,$2,$3,$4,'2026-01-01',$5,$6,$7,$8,2,'long',2,0,'option','USD','synthetic',$9::jsonb,100,$10,$11,'call')",[id,owner,symbol,d.symbol,execs[0].datetime,execs[1].datetime,execs[0].price,execs[1].price,JSON.stringify(execs),strike,expiry]);
  }
  const optBase=base.slice(0,base.lastIndexOf('/'))+'/'+op;
  async function optCall(path,method,body){const r=await fetch(optBase+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
  const optVersion=async()=>(await db.query('SELECT version FROM trade_plans WHERE id=$1',[op])).rows[0].version;
  const oldSource=require(root+'/src/services/planningLedger').sourceFills((await db.query('SELECT * FROM trades WHERE id=$1',[ot])).rows[0]);
  const newSource=require(root+'/src/services/planningLedger').sourceFills((await db.query('SELECT * FROM trades WHERE id=$1',[nt])).rows[0]);
  const exactCandidates=(await optCall('/fills','GET')).data.fills;
  assert(exactCandidates.length===2&&exactCandidates.every(f=>f.tradeId===ot),'ordinary option finder scopes exact contract');
  const rollCandidates=(await optCall('/fills?purpose=roll','GET')).data.fills;
  assert(rollCandidates.some(f=>f.tradeId===nt)&&rollCandidates.some(f=>f.tradeId===ot),'roll finder permits both contracts within the same account');
  assert.equal((await optCall('/allocations','POST',{version:await optVersion(),tradeId:ot,sourceKey:oldSource[0].key,fingerprint:oldSource[0].fingerprint,stageKey:'a',action:'entry',quantity:2})).status,201,'option entry');
  const rollBody={version:await optVersion(),close:{tradeId:ot,sourceKey:oldSource[1].key,fingerprint:oldSource[1].fingerprint,quantity:2},open:{tradeId:nt,sourceKey:newSource[0].key,fingerprint:newSource[0].fingerprint,quantity:2},delta:60,reason:'Synthetic credit roll'};
  assert.equal((await optCall('/roll','POST',rollBody)).status,422,'risk-increasing roll rejected');
  rollBody.delta=40;const creditResult=await optCall('/roll','POST',rollBody);assert.equal(creditResult.status,201,'atomic credit roll: '+creditResult.data.error);
  assert.equal((await optCall('/workflow','GET')).data.ledger.openQuantity,2,'roll retains exposure');
  assert.equal((await optCall('/allocations','POST',{version:await optVersion(),tradeId:nt,sourceKey:newSource[1].key,fingerprint:newSource[1].fingerprint,stageKey:'b',action:'exit',quantity:2})).status,201,'rolled contract final exit');
  const rolled=(await optCall('/workflow','GET')).data.ledger;assert.equal(rolled.realisedProfit,496);assert.equal(rolled.percentGain,124);assert.equal(rolled.economicallyClosed,true);
  console.log('PASS: TEST options exact-contract links, credit roll, risk-increase rejection, retained exposure and net premium profit');
  console.log('PASS: TEST database entry, partial/final exits, fees, original R, stop history, concurrency, review, completion and source correction');
 }catch(e){console.error('FAIL: synthetic planning integration:',e.message);process.exitCode=1}
 finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await db.query('DELETE FROM trade_plans WHERE user_id=$1',[owner]);
  await db.query('DELETE FROM users WHERE id=$1',[owner]);
  await db.pool.end();
 }
})();
