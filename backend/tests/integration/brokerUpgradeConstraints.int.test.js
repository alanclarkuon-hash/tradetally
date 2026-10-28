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

test('upgraded trades provide the simulation flag without changing source financial values',async()=>{
 const client=await db.pool.connect();
 try{
  await client.query('BEGIN');
  const column=await client.query("SELECT data_type,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='trades' AND column_name='is_simulated'");
  expect(column.rows).toEqual([expect.objectContaining({data_type:'boolean'})]);
  await client.query('CREATE SCHEMA simulation_upgrade_regression');
  await client.query('SET LOCAL search_path=simulation_upgrade_regression,public');
  await client.query('CREATE TABLE trades(id integer,entry_price numeric,quantity numeric,pnl numeric)');
  await client.query('INSERT INTO trades VALUES(1,100,2,12.34)');
  const before=(await client.query('SELECT to_jsonb(t) AS row FROM trades t')).rows;
  const migration=fs.readFileSync(path.join(__dirname,'../../migrations/913_add_trade_simulation_flag.sql'),'utf8');
  await client.query(migration);
  expect((await client.query("SELECT to_jsonb(t)-'is_simulated' AS row FROM trades t")).rows).toEqual(before);
  expect((await client.query('SELECT is_simulated FROM trades')).rows).toEqual([{is_simulated:false}]);
  await client.query('UPDATE trades SET is_simulated=true WHERE id=1');
  await client.query(migration);
  expect((await client.query('SELECT is_simulated FROM trades')).rows).toEqual([{is_simulated:true}]);
 }finally{await client.query('ROLLBACK');client.release();}
});
