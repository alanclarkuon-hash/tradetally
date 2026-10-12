/* TEST-only synthetic multi-account API check; all records are removed. */
const root='/app/backend',db=require(root+'/src/config/database'),express=require(root+'/node_modules/express'),assert=require('assert/strict'),crypto=require('crypto');
if(process.env.DB_NAME!=='tradetally_test')throw Error('TEST database only');
const owner=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID(),pb=crypto.randomUUID(),id=crypto.randomUUID(),ta=crypto.randomUUID(),tb=crypto.randomUUID();let server;
(async()=>{try{
 await db.query("INSERT INTO users(id,email,username,password_hash,is_active,is_verified,tier) VALUES($1,$2,$3,'not-login',false,false,'pro')",[owner,'synthetic-'+owner+'@example.invalid','synthetic-'+owner]);
 for(const [aid,name,currency] of [[a,'synthetic-a','GBP'],[b,'synthetic-b','USD']])await db.query("INSERT INTO user_accounts(id,user_id,account_name,account_identifier,initial_balance_date,currency) VALUES($1,$2,$3,$3,CURRENT_DATE,$4)",[aid,owner,name,currency]);
 await db.query("INSERT INTO playbooks(id,user_id,name) VALUES($1,$2,'Synthetic multi account')",[pb,owner]);
 const d=require(root+'/src/services/tradePlanning').normalize({title:'Synthetic',thesis:'Synthetic test',exceptionReason:'Synthetic chart evidence',symbol:'SYNTEST',instrument:'stock',direction:'long',accountId:a,accountIds:[b],currency:'USD',playbookId:pb,riskBudget:100,stopPrice:90,quantityStep:1,pointSize:1,entries:[{key:'a',label:'A',tactic:'Synthetic trigger',price:100,riskWeight:50},{key:'b',label:'B',tactic:'Synthetic trigger',price:100,riskWeight:50,accountId:b}],exits:[{key:'x',label:'X',price:110,percent:100},{key:'y',label:'Y',price:110,percent:100,accountId:b}]});
 await db.query("INSERT INTO trade_plans(id,user_id,playbook_id,status,finalised,definition) VALUES($1,$2,$3,'watching',true,$4::jsonb)",[id,owner,pb,JSON.stringify(d)]);
 for(const [tid,acct,cur] of [[ta,'synthetic-a','GBP'],[tb,'synthetic-b','USD']]){const executions=[{id:'entry',action:'buy',quantity:5,price:100,datetime:'2026-01-01T10:00:00Z',commission:0,fees:0,account_currency:cur,broker_fx_rate:cur==='GBP'?1.25:1},{id:'exit',action:'sell',quantity:5,price:110,datetime:'2026-01-02T10:00:00Z',commission:0,fees:0,account_currency:cur,broker_fx_rate:cur==='GBP'?1.25:1}];await db.query("INSERT INTO trades(id,user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,side,commission,fees,instrument_type,original_currency,account_identifier,executions) VALUES($1,$2,'SYNTEST','2026-01-01','2026-01-01T10:00:00Z','2026-01-02T10:00:00Z',100,110,5,'long',0,0,'stock','USD',$3,$4::jsonb)",[tid,owner,acct,JSON.stringify(executions)])}
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:owner};next()});const auth=require(root+'/src/middleware/auth'),original=auth.authenticate;auth.authenticate=(req,res,next)=>next();app.use('/plans',require(root+'/src/routes/tradePlanning.routes'));auth.authenticate=original;
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/plans/'+id;
 const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
 const version=async()=>(await db.query('SELECT version FROM trade_plans WHERE id=$1',[id])).rows[0].version;
 const riskResponse=await fetch(base.slice(0,base.lastIndexOf('/'))+'/risk');assert.equal(riskResponse.status,200,'risk coverage API');const risk=await riskResponse.json();assert.equal(risk.accounts.length,2,'risk coverage includes both owned accounts');
 await db.query('INSERT INTO trade_planning_settings(user_id,settings) VALUES($1,$2::jsonb)',[owner,JSON.stringify({currency:'USD',portfolioLimit:75,accountLimits:[{accountId:a,limit:40},{accountId:b,limit:100}]})]);
 const commitBody=async key=>({version:await version(),stageKey:key,checks:{trigger:true,context:true,protection:true,data:true},journalExceptionReason:'Synthetic missing journal evidence',riskOverrideReason:'Synthetic capacity verification'});
 const rejected=await call('/commitments','POST',await commitBody('a'));assert.equal(rejected.status,422);assert.match(rejected.data.error,/Account risk limit/,'known account limit cannot be overridden');
 await db.query("UPDATE trade_planning_settings SET settings=jsonb_set(settings,'{accountLimits,0,limit}','100'::jsonb) WHERE user_id=$1",[owner]);
 const firstCommit=await call('/commitments','POST',await commitBody('a'));assert.equal(firstCommit.status,201,'verified first-account commitment: '+JSON.stringify(firstCommit.data));
 const combinedRejected=await call('/commitments','POST',await commitBody('b'));assert.equal(combinedRejected.status,422);assert.match(combinedRejected.data.error,/Combined trading-account risk limit/,'outstanding risk consumes combined capacity');
 const sources={};for(const tid of [ta,tb])sources[tid]=require(root+'/src/services/planningLedger').sourceFills((await db.query('SELECT * FROM trades WHERE id=$1',[tid])).rows[0]);
 const link=async(tid,index,key)=>call('/allocations','POST',{version:await version(),tradeId:tid,sourceKey:sources[tid][index].key,fingerprint:sources[tid][index].fingerprint,stageKey:key,action:index?'exit':'entry',quantity:5});
 assert.equal((await call('/fills?accountId='+b)).data.fills.every(f=>f.tradeId===tb),true,'finder account scope');
 assert.equal((await link(ta,0,'b')).status,422,'wrong account rejected');
 assert.equal((await link(ta,0,'a')).status,201,'first account entry');
 assert.equal((await link(tb,1,'y')).status,409,'other account entry cannot fund exit');
 assert.equal((await link(tb,0,'b')).status,201,'second account entry');
 assert.equal((await link(ta,1,'x')).status,201);assert.equal((await link(tb,1,'y')).status,201);
 const w=(await call('/workflow')).data.ledger;assert.equal(w.coverageComplete,true);assert.equal(w.economicallyClosed,true);assert.equal(w.accounts.length,2);
 assert.equal(w.accounts.find(x=>x.accountId===a).realisedProfit,40);assert.equal(w.accounts.find(x=>x.accountId===b).realisedProfit,50);
 console.log('PASS: TEST multi-account finder scope, account ownership, independent exits, broker FX and account-native profits');
}catch(e){console.error('FAIL: synthetic multi-account:',e.message);process.exitCode=1}finally{if(server)await new Promise(r=>server.close(r));await db.query('DELETE FROM trade_plans WHERE user_id=$1',[owner]);await db.query('DELETE FROM users WHERE id=$1',[owner]);await db.pool.end()}})();
