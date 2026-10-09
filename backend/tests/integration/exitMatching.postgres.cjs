/* TEST-only synthetic integration; no broker requests. Cleans up all records. */
const root=process.env.PLANNING_BACKEND_ROOT||'/app/backend';
const db=require(root+'/src/config/database'),crypto=require('crypto'),assert=require('assert/strict');
const service=require(root+'/src/services/exitMatching'),reconcile=require(root+'/src/services/brokerSync/trading212Reconcile');
if(process.env.DB_NAME!=='tradetally_test')throw new Error('Restricted to TEST database');
const user=crypto.randomUUID(),connection=crypto.randomUUID(),source=crypto.randomUUID(),target=crypto.randomUUID();
const buy={action:'buy',type:'entry',order_id:'synthetic-buy',price:100,quantity:2,datetime:'2026-01-01T12:00:00Z',fees:1};
const buy2={...buy,order_id:'synthetic-buy2',price:105,datetime:'2026-01-02T12:00:00Z',fees:2};
const sell={action:'sell',type:'exit',order_id:'synthetic-sell',price:110,quantity:2,datetime:'2026-01-03T12:00:00Z',fees:2};
const original=[{symbol:'SYNEXIT',side:'long',instrumentType:'stock',executionData:[buy,sell],accountIdentifier:'synthetic',originalCurrency:'USD'},
 {symbol:'SYNEXIT',side:'long',instrumentType:'stock',executionData:[buy2],accountIdentifier:'synthetic',originalCurrency:'USD'}];
const raw=[buy,buy2,sell].map(e=>({fill:{id:e.order_id,quantity:e.quantity}}));
const read=id=>db.query('SELECT * FROM trades WHERE id=$1',[id]).then(r=>r.rows[0]);
const sync=()=>reconcile.reconcileSnapshot({id:connection,userId:user},raw,original);
(async()=>{try{
 await db.query("INSERT INTO users(id,email,username,password_hash,is_active,is_verified,tier,timezone) VALUES($1,$2,$3,'not-a-login-hash',false,false,'pro','UTC')",[user,'exit-'+user+'@example.invalid','exit-'+user]);
 await db.query("INSERT INTO broker_connections(id,user_id,broker_type,connection_status,auto_sync_enabled) VALUES($1,$2,'trading212','pending',false)",[connection,user]);
 for(const [id,execs] of [[source,[buy,sell]],[target,[buy2]]]){
 const a=require(root+'/src/services/pnlEngine').computeTradePnl({side:'long',instrumentType:'stock',executions:execs,timezone:'UTC'}).aggregate;
 await db.query(`INSERT INTO trades(id,user_id,symbol,broker,broker_connection_id,trade_date,entry_time,exit_time,entry_price,exit_price,
 quantity,side,commission,fees,pnl,pnl_percent,instrument_type,original_currency,account_identifier,executions)
 VALUES($1,$2,'SYNEXIT','trading212',$3,$4,$5,$6,$7,$8,$9,'long',$10,$11,$12,$13,'stock','USD','synthetic',$14::jsonb)`,
 [id,user,connection,a.trade_date,a.entry_time,a.exit_time,a.entry_price,a.exit_price,a.quantity,a.commission,a.fees,a.pnl,a.pnl_percent,JSON.stringify(execs)]);
 }
 const before=await service.state(user,source);
 await assert.rejects(()=>service.state(crypto.randomUUID(),source),e=>e.status===404);
 const request={operation:'detach',index:1,version:before.version,reason:'Synthetic wrong lot'};
 const record=await service.correct(user,source,request);
 const reopened=await read(source);assert.equal(reopened.exit_time,null);assert.equal(reopened.pnl,null);assert.equal(Number(reopened.fees),1);
 await assert.rejects(()=>service.correct(user,source,request),e=>e.status===409);
 assert.equal((await service.state(user,target)).available.length,1);
 await sync();assert.equal((await read(source)).exit_time,null,'sync preserves detached exit');
 const targetVersion=service.version(await read(target));
 // Test invalid quantity with another synthetic target snapshot; failure must roll back.
 await db.query('UPDATE trades SET executions=$2::jsonb WHERE id=$1',[target,JSON.stringify([{...buy2,quantity:1}])]);
 await assert.rejects(async()=>service.correct(user,target,{operation:'attach',exitId:record.exitId,version:service.version(await read(target)),reason:'Synthetic oversell'}),/exceeds/);
 assert.equal((await service.state(user,target)).available.length,1);
 await db.query('UPDATE trades SET executions=$2::jsonb WHERE id=$1',[target,JSON.stringify([buy2])]);
 const restoredVersion=service.version(await read(target));
 const attempts=await Promise.allSettled([1,2].map(()=>service.correct(user,target,{operation:'attach',exitId:record.exitId,version:restoredVersion,reason:'Synthetic correct lot'})));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1,'concurrent relinks apply once');
 assert.equal((await service.state(user,target)).available.length,0);
 const linked=await read(target);assert.equal(Number(linked.pnl),6);assert.equal(Number(linked.fees),4);
 const unlinked=await read(source);assert.equal(Number(unlinked.fees)+Number(linked.fees),5,'fees conserved');
 await sync();assert.equal(Number((await read(target)).pnl),6,'sync preserves assigned exit and P&L');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM trades WHERE user_id=$1',[user])).rows[0].n,2,'sync does not duplicate trades');
 const changed=original.map(t=>({...t,executionData:t.executionData.map(e=>e.action==='sell'?{...e,price:111}:e)}));
 await assert.rejects(()=>reconcile.reconcileSnapshot({id:connection,userId:user},raw,changed),/evidence changed/);
 assert.equal(Number((await read(target)).pnl),6,'changed evidence leaves correction intact');
 // Detach again and restore to original trade: the same preserved sell can be corrected back.
 const second=await service.correct(user,target,{operation:'detach',index:1,version:service.version(await read(target)),reason:'Synthetic reversal'});
 assert.equal(second.exitId,record.exitId);
 await service.correct(user,source,{operation:'attach',exitId:record.exitId,version:service.version(await read(source)),reason:'Synthetic restore'});
 await sync();assert.equal(Number((await read(source)).pnl),17);assert.equal((await read(target)).exit_time,null);
 console.log('PASS: TEST owner boundaries, detach/reopen, fees/quantity conservation, invalid exit rollback, concurrent single relink, reconciliation preservation, changed-evidence protection and correction reversal');
}catch(e){console.error('FAIL: synthetic exit matching integration:',e.message);process.exitCode=1}
finally{await db.query('DELETE FROM trade_exit_matching_history WHERE user_id=$1',[user]);await db.query('DELETE FROM detached_trade_exits WHERE user_id=$1',[user]);await db.query('DELETE FROM users WHERE id=$1',[user]);await db.pool.end()}})();
