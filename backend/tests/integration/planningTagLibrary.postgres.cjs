/* TEST-only synthetic library lifecycle check; no real user records are edited. */
const root=process.env.PLANNING_BACKEND_ROOT||'/app/backend';
const db=require(root+'/src/config/database'),express=require(root+'/node_modules/express'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
if(process.env.DB_NAME!=='tradetally_test')throw new Error('TEST database required');
const owner=randomUUID(),other=randomUUID();let server;
(async()=>{try{
 for(const id of [owner,other])await db.query("INSERT INTO users(id,email,username,password_hash,is_active,is_verified) VALUES($1,$2,$3,'not-a-login-hash',false,false)",[id,'tag-test-'+id+'@example.invalid','tag-test-'+id]);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:owner};next()});app.use('/plans',require(root+'/src/routes/planningLifecycle.routes'));app.use((e,req,res,next)=>res.status(500).json({error:'Internal'}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/plans/library';
 async function call(method,path,body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}}
 const created=await call('POST','',{kind:'entry',name:'Synthetic entry',definition:'Initial'});assert.equal(created.status,201);const id=created.body.tag.id;
 const edited=await call('PUT','/'+id,{kind:'context',name:'Synthetic renamed',definition:'Revised'});assert.equal(edited.status,200);assert.equal(edited.body.tag.id,id);assert.equal(edited.body.tag.kind,'context');
 await call('POST','',{kind:'context',name:'Duplicate'});assert.equal((await call('PUT','/'+id,{kind:'context',name:'Duplicate'})).status,409);
 const foreign=(await db.query("INSERT INTO trade_plan_tags(user_id,kind,name) VALUES($1,'entry','Foreign') RETURNING id",[other])).rows[0].id;
 assert.equal((await call('PUT','/'+foreign,{kind:'entry',name:'Hijacked'})).status,404);assert.equal((await call('DELETE','/'+foreign)).status,404);
 assert.equal((await call('DELETE','/'+id)).status,200);assert.equal((await db.query('SELECT count(*)::int AS n FROM trade_plan_tags WHERE id=$1',[id])).rows[0].n,0);
 assert.equal((await db.query('SELECT name FROM trade_plan_tags WHERE id=$1',[foreign])).rows[0].name,'Foreign');
 console.log('PASS: create, rename, recategorise, duplicate rejection, cross-owner protection and delete on real TEST PostgreSQL');
}finally{if(server)await new Promise(r=>server.close(r));await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[owner,other]]);await db.pool.end()}})().catch(e=>{console.error(e);process.exitCode=1});
