const fs=require('fs');
const path=require('path');
const {randomUUID}=require('crypto');
const db=require('../../src/config/database');

afterAll(async()=>{await db.pool.end();});
test('Webull and Tradovate upgrade migrations retain existing fork broker connections',async()=>{
 const client=await db.pool.connect();
 try {
  await client.query('BEGIN');
  const suffix=randomUUID().slice(0,8);
  const user=(await client.query("INSERT INTO users(email,username,password_hash) VALUES($1,$2,'synthetic') RETURNING id",[`upgrade-${suffix}@example.com`,`upgrade_${suffix}`])).rows[0].id;
  await client.query('ALTER TABLE broker_connections DROP CONSTRAINT IF EXISTS broker_connections_broker_type_check');
  await client.query("ALTER TABLE broker_connections ADD CONSTRAINT broker_connections_broker_type_check CHECK(broker_type IN ('ibkr','schwab','tradestation','alpaca','trading212','etoro','okx','kraken'))");
  for(const broker of ['etoro','okx','kraken','trading212'])await client.query('INSERT INTO broker_connections(user_id,broker_type) VALUES($1,$2)',[user,broker]);
  for(const name of ['268_add_webull_broker_connections.sql','269_add_tradovate_broker_sync.sql']){
   await client.query(fs.readFileSync(path.join(__dirname,'../../migrations',name),'utf8'));
   const retained=(await client.query('SELECT broker_type FROM broker_connections WHERE user_id=$1 ORDER BY broker_type',[user])).rows.map(r=>r.broker_type);
   expect(retained).toEqual(['etoro','kraken','okx','trading212']);
  }
  for(const broker of ['webull','tradovate'])await client.query('INSERT INTO broker_connections(user_id,broker_type) VALUES($1,$2)',[user,broker]);
 } finally {await client.query('ROLLBACK');client.release();}
});
