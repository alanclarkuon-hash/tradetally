const {randomUUID}=require('crypto');
jest.mock('../../src/utils/jobQueue',()=>({notifyJobEnqueued:jest.fn()}));
const db=require('../../src/config/database');
const history=require('../../src/services/historyBackfillService');
const inputs=require('../../src/services/historySyncScope');
let user;
beforeAll(async()=>{
 const suffix=randomUUID().slice(0,8);
 user=(await db.query("INSERT INTO users(email,username,password_hash) VALUES($1,$2,'synthetic') RETURNING id",[`history-${suffix}@example.com`,`history_${suffix}`])).rows[0].id;
 await db.query("INSERT INTO user_accounts(user_id,account_name,account_identifier,broker,initial_balance_date,currency) VALUES($1,'Synthetic Kraken','kraken-a','kraken','2025-01-01','USD'),($1,'Untouched eToro','etoro-a','etoro','2025-01-01','USD')",[user]);
 await db.query("INSERT INTO portfolio_reconstructed_values(user_id,account_identifier,value_date,holdings_usd,cash_usd,stablecoins_usd,issues,method) VALUES($1,'kraken-a','2026-10-11',0,0,0,'[]','synthetic')",[user]);
});
afterEach(async()=>{await db.query('DELETE FROM job_queue WHERE user_id=$1',[user]);});
afterAll(async()=>{if(user)await db.query('DELETE FROM users WHERE id=$1',[user]);await db.pool.end();});
test('real persisted inputs detect only changed broker history and do not enqueue an unchanged sync',async()=>{
 const before=await inputs.capture(user,'kraken',randomUUID());
 expect(inputs.difference(before,await inputs.capture(user,'kraken',randomUUID()),'2026-10-11')).toEqual({accounts:{}});
 await db.query("INSERT INTO trades(user_id,symbol,side,quantity,entry_price,trade_date,entry_time,instrument_type,broker,account_identifier) VALUES($1,'BTC','long',1,100,'2026-10-01','2026-10-01','crypto','kraken','kraken-a')",[user]);
 const scope=inputs.difference(before,await inputs.capture(user,'kraken',randomUUID()),'2026-10-11');
 expect(scope).toEqual({accounts:{'kraken-a':'2026-10-01'}});
 const id=await history.enqueue(user,scope);
 expect((await db.query('SELECT data FROM job_queue WHERE id=$1',[id])).rows[0].data.scope).toEqual(scope);
 expect(await history.enqueue(user,{accounts:{}})).toBeNull();
});
test('concurrent requests merge without losing scope and leave active work untouched',async()=>{
 const active=await history.enqueue(user,{accounts:{'kraken-a':'2026-10-01'}});
 await db.query("UPDATE job_queue SET status='processing',result=$2 WHERE id=$1",[active,JSON.stringify({tasks:[{symbol:'BTC'}],processed:1})]);
 const ids=await Promise.all([history.enqueue(user,{accounts:{'kraken-a':'2026-09-01'}}),history.enqueue(user,{accounts:{'etoro-a':'2026-10-02'}})]);
 expect(ids[0]).toBe(ids[1]);expect(ids[0]).not.toBe(active);
 const rows=(await db.query('SELECT id,data,result FROM job_queue WHERE user_id=$1',[user])).rows;
 expect(rows.find(r=>r.id===active).result.processed).toBe(1);
 expect(rows.find(r=>r.id===ids[0]).data.scope.accounts).toEqual({'kraken-a':'2026-09-01','etoro-a':'2026-10-02'});
 await history.enqueue(user);
 expect((await db.query('SELECT data FROM job_queue WHERE id=$1',[ids[0]])).rows[0].data.scope).toBeNull();
});
test('a restarted pending job retains its saved cursor and gets a separate followup',async()=>{
 const resumed=await history.enqueue(user,{accounts:{'kraken-a':'2026-10-01'}});
 await db.query('UPDATE job_queue SET result=$2 WHERE id=$1',[resumed,JSON.stringify({tasks:[{symbol:'BTC'}],processed:1})]);
 const followup=await history.enqueue(user,{accounts:{'kraken-a':'2026-09-01'}});
 expect(followup).not.toBe(resumed);
 expect((await db.query('SELECT result FROM job_queue WHERE id=$1',[resumed])).rows[0].result.processed).toBe(1);
});
