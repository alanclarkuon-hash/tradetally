// Scratch database only: prove release/restart recovery preserves price work.
jest.mock('../../src/services/portfolioService',()=>({_getDailySeries:jest.fn()}));
jest.mock('../../src/services/brokerPortfolioMaintenance',()=>({maintain:jest.fn().mockResolvedValue({warnings:[]})}));
jest.mock('../../src/services/analyticsCache',()=>({invalidate:jest.fn().mockResolvedValue()}));
const {randomUUID}=require('crypto');
const db=require('../../src/config/database');
const history=require('../../src/services/historyBackfillService');
const recovery=require('../../src/services/jobRecoveryService');
const portfolio=require('../../src/services/portfolioService');
let userId;
beforeAll(async()=>{const suffix=randomUUID().slice(0,8);userId=(await db.query("INSERT INTO users(email,username,password_hash) VALUES($1,$2,'test') RETURNING id",[`history-${suffix}@example.com`,`history_${suffix}`])).rows[0].id;});
afterEach(async()=>{await db.query('DELETE FROM job_queue WHERE user_id=$1',[userId]);jest.clearAllMocks();});
afterAll(async()=>{await db.query('DELETE FROM users WHERE id=$1',[userId]);await db.pool.end();});
test('stale lease recovery retains serialized cursor and queued followup, and resumes only unfinished prices',async()=>{
 const tasks=[{symbol:'DONE',instrumentType:'crypto',from:'2026-01-01',to:'2026-01-01'},{symbol:'REMAINING',instrumentType:'crypto',from:'2026-01-01',to:'2026-01-01'}];
 const saved={tasks,processed:1,total:2,complete:1,gaps:[],stage:'prices'};
 const first=(await db.query("INSERT INTO job_queue(type,user_id,data,status,result,priority,created_at,started_at) VALUES('historical_price_backfill',$1,'{}','processing',$2,4,NOW()-INTERVAL '1 hour',NOW()-INTERVAL '20 minutes') RETURNING id",[userId,JSON.stringify(saved)])).rows[0].id;
 const followup=(await db.query("INSERT INTO job_queue(type,user_id,data,status,priority) VALUES('historical_price_backfill',$1,'{}','pending',4) RETURNING id",[userId])).rows[0].id;
 await recovery.resetStuckJobs();
 const retained=(await db.query('SELECT status,result FROM job_queue WHERE id=$1',[first])).rows[0];
 expect(retained).toEqual({status:'pending',result:saved});
 const job=await history.claim();expect(job.id).toBe(first);
 portfolio._getDailySeries.mockResolvedValue([{time:Date.parse('2026-01-01')/1000,close:1}]);
 const done=await history.process(job);
 expect(portfolio._getDailySeries).toHaveBeenCalledTimes(1);
 expect(portfolio._getDailySeries).toHaveBeenCalledWith('REMAINING','2026-01-01','2026-01-01',userId,{instrumentType:'crypto'});
 expect(done).toMatchObject({processed:2,total:2,complete:2,stage:'finished',tasks});
 expect((await db.query('SELECT result FROM job_queue WHERE id=$1',[first])).rows[0].result).toMatchObject({processed:2,stage:'finished'});
 expect((await db.query('SELECT status FROM job_queue WHERE id=$1',[followup])).rows[0].status).toBe('pending');
});
test('fresh worker heartbeat is not recovered as a stuck job',async()=>{
 const id=(await db.query("INSERT INTO job_queue(type,user_id,data,status,result,started_at) VALUES('historical_price_backfill',$1,'{}','processing',$2,NOW()) RETURNING id",[userId,JSON.stringify({processed:4,total:9,lastHeartbeatAt:new Date().toISOString()})])).rows[0].id;
 await recovery.resetStuckJobs();
 expect((await db.query('SELECT status,result FROM job_queue WHERE id=$1',[id])).rows[0]).toMatchObject({status:'processing',result:{processed:4,total:9}});
});
