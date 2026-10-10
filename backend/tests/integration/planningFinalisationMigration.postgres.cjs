// Synthetic TEST-only migration probe. No real records are modified.
const root='/app/backend',db=require(root+'/src/config/database'),fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');
if(process.env.DB_NAME!=='tradetally_test')throw Error('TEST database only');
const marker='/tmp/planning-finalisation-migration-probe.json';
(async()=>{try{if(process.argv.includes('--prepare')){
 const owner=crypto.randomUUID(),plan=crypto.randomUUID();
 const definition=require(root+'/src/services/tradePlanning').normalize({title:'Synthetic migration',symbol:'SYNTEST',instrument:'stock',direction:'long',currency:'USD',riskBudget:100,stopPrice:90,quantityStep:1,entries:[{key:'a',label:'Entry',price:100,riskWeight:100,tactic:'Condition'}],exits:[]});
 await db.withTransaction(async c=>{await c.query("INSERT INTO users(id,email,username,password_hash,is_active,is_verified,tier) VALUES($1,$2,$3,'not-a-login-hash',false,false,'pro')",[owner,'migration-'+owner+'@example.invalid','migration-'+owner]);await c.query("INSERT INTO trade_plans(id,user_id,status,definition) VALUES($1,$2,'ready',$3::jsonb)",[plan,owner,JSON.stringify(definition)]);await c.query("INSERT INTO trade_plan_events(plan_id,user_id,event_type,snapshot) VALUES($1,$2,'ready',$3::jsonb)",[plan,owner,JSON.stringify({status:'ready',definition})]);});
 fs.writeFileSync(marker,JSON.stringify({owner,plan,definition}));console.log('Synthetic legacy Ready migration probe prepared');
 }else{const {owner,plan,definition}=JSON.parse(fs.readFileSync(marker));try{
 const p=(await db.query('SELECT * FROM trade_plans WHERE id=$1 AND user_id=$2',[plan,owner])).rows[0];assert.equal(p.status,'draft');assert.equal(p.finalised,true);assert.equal(p.version,2);assert.deepEqual(p.definition,definition);assert.equal((await db.query("SELECT count(*)::int AS n FROM trade_plan_events WHERE plan_id=$1 AND event_type='ready'",[plan])).rows[0].n,1);console.log('Migration verified: finalised Draft, original definition and history retained');
 }finally{await db.query('DELETE FROM users WHERE id=$1',[owner]);fs.unlinkSync(marker)}}
 }finally{await db.pool.end()}})().catch(()=>{console.error('Synthetic migration verification failed');process.exitCode=1});
