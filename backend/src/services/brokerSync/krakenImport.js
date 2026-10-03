const db=require('../../config/database');
const AnalyticsCache=require('../analyticsCache');
const {prepare}=require('./krakenLots');
const day=time=>new Date(Number(time)*1000).toISOString().slice(0,10);
async function reconcile(connection,payload,{dryRun=false}={}) {
  const mapped=prepare(payload),identifier=`Kraken ****${String(connection.externalAccountId).slice(-4)}`;
  const result={imported:0,updated:0,duplicates:0,skipped:0,failed:0,tradeRows:Object.keys(payload.trades).length,openPositionRows:mapped.positions.length};
  await db.withTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`kraken:${connection.userId}:${connection.externalAccountId}`]);
    const existing=(await client.query("SELECT id,executions FROM trades WHERE user_id=$1 AND broker='kraken' AND account_identifier=$2 FOR UPDATE",
      [connection.userId,identifier])).rows;
    const old=new Map(existing.map(t=>[t.executions?.[0]?.kraken_record_key,t]));
    if(existing.some(t=>!t.executions?.[0]?.kraken_record_key)||old.size!==existing.length)throw Error('Unrecognised or duplicated Kraken journal identity');
    const incoming=new Set(mapped.trades.map(t=>t.key));
    if(incoming.size!==mapped.trades.length)throw Error('Duplicate Kraken reconstructed trade identity');
    for(const [key] of old)if(!incoming.has(key)&&!key.endsWith(':open'))throw Error('Kraken reconciliation would remove a closed trade');
    result.imported=mapped.trades.filter(t=>!old.has(t.key)).length;result.updated=mapped.trades.length-result.imported;
    if(dryRun)return;
    let accounts=(await client.query("SELECT * FROM user_accounts WHERE user_id=$1 AND broker='kraken' AND account_identifier=$2 FOR UPDATE",
      [connection.userId,identifier])).rows;
    if(accounts.length>1)throw Error('Multiple managed Kraken accounts match this connection');
    if(!accounts.length)accounts=(await client.query(`INSERT INTO user_accounts(user_id,account_name,account_identifier,broker,currency,initial_balance,initial_balance_date,notes)
      VALUES($1,$2,$3,'kraken','USD',0,$4,$5) RETURNING *`,[connection.userId,connection.accountLabel||'Kraken',identifier,
      day(Math.min(...Object.values(payload.ledger).map(l=>l.time))),
      'Spot and Earn/staking. USD reporting includes GBP and USD fiat wallets. Stablecoins stay in investments. External crypto transfers are not new deposits.'])).rows;
    if(accounts[0].currency!=='USD'||Number(accounts[0].initial_balance)!==0)throw Error('Kraken needs a zero-opening USD reporting account');
    for(const [key,t] of old)if(!incoming.has(key))await client.query('DELETE FROM trades WHERE user_id=$1 AND id=$2',[connection.userId,t.id]);
    for(const t of mapped.trades) {
      const executions=[{kraken_record_key:t.key,feesIncluded:true,valuationMethod:payload.valuation.method,notes:t.notes||null}];
      const cost=t.entryPrice*t.quantity;
      const values=[connection.userId,t.symbol,(t.exitTime||t.entryTime).slice(0,10),t.entryTime,t.exitTime,t.entryPrice,t.exitPrice,t.quantity,
        t.pnl,t.pnl==null||cost===0?null:t.pnl/cost*100,JSON.stringify(executions),connection.id,identifier,t.side||'long',t.notes||null];
      if(old.has(t.key))await client.query(`UPDATE trades SET symbol=$2,trade_date=$3,entry_time=$4,exit_time=$5,entry_price=$6,exit_price=$7,
        quantity=$8,pnl=$9,pnl_percent=$10,executions=$11::jsonb,broker_connection_id=$12,account_identifier=$13,side=$14,notes=$15,updated_at=NOW()
        WHERE user_id=$1 AND id=$16`,[...values,old.get(t.key).id]);
      else await client.query(`INSERT INTO trades(user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,pnl,pnl_percent,
        executions,broker_connection_id,account_identifier,side,notes,broker,instrument_type,original_currency,exchange_rate,commission,fees)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,'kraken','crypto','USD',1,0,0)`,values);
    }
    const events=[...mapped.events];
    for(const [id,l] of Object.entries(payload.ledger))if(['ZUSD','ZGBP'].includes(l.asset)&&l.type!=='trade'&&Number(l.fee)>0) {
      const currency=l.asset==='ZUSD'?'USD':'GBP',rate=currency==='USD'?1:payload.valuation.rates.GBP[day(l.time)];
      events.push({key:id+':fee',type:'account_fee',time:l.time,amount:-Number(l.fee),currency,amountUsd:-Number(l.fee)*rate,description:'Kraken cash conversion or withdrawal fee'});
    }
    for(const e of events)await client.query(`INSERT INTO broker_cash_events(user_id,account_id,broker_type,reference_id,event_type,event_date,amount,currency,amount_usd,description)
      VALUES($1,$2,'kraken',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,account_id,broker_type,reference_id)
      DO UPDATE SET event_type=EXCLUDED.event_type,amount=EXCLUDED.amount,currency=EXCLUDED.currency,amount_usd=EXCLUDED.amount_usd,
      description=EXCLUDED.description,updated_at=NOW()`,[connection.userId,accounts[0].id,e.key,e.type,day(e.time),e.amount,e.currency,
      e.amountUsd??e.amount,e.description]);
    await client.query(`INSERT INTO broker_portfolio_snapshots(user_id,broker_type,account_identifier,connection_id,positions,synced_at)
      VALUES($1,'kraken',$2,$3,$4::jsonb,$5) ON CONFLICT(user_id,broker_type,account_identifier)
      DO UPDATE SET positions=EXCLUDED.positions,connection_id=EXCLUDED.connection_id,synced_at=EXCLUDED.synced_at`,
    [connection.userId,identifier,connection.id,JSON.stringify(mapped.positions),payload.valuation.asOf]);
    payload={...payload,reconciled:true,nativeReconciliation:mapped.check,reportingMethod:'FIFO in USD; Earn rewards at receipt-date closing value',
      transferClassification:'Incoming USDT funding is external exchange/wallet transfers; original tax basis unavailable'};
    await client.query(`INSERT INTO broker_import_snapshots(user_id,broker_type,account_identifier,connection_id,payload,captured_at)
      VALUES($1,'kraken',$2,$3,$4::jsonb,NOW()) ON CONFLICT(user_id,broker_type,account_identifier)
      DO UPDATE SET payload=EXCLUDED.payload,connection_id=EXCLUDED.connection_id,captured_at=NOW()`,
    [connection.userId,identifier,connection.id,JSON.stringify(payload)]);
    await client.query("UPDATE broker_connections SET broker_metadata=broker_metadata || '{\"import_pending_review\":false}'::jsonb WHERE user_id=$1 AND id=$2",
      [connection.userId,connection.id]);
    await client.query('DELETE FROM analytics_cache WHERE user_id=$1',[connection.userId]);
    result.incomeRows=mapped.events.filter(e=>e.type==='interest').length;
  });
  if(!dryRun)await AnalyticsCache.invalidate(connection.userId);
  result.warnings=['Earn rewards are net of native reward fees and valued at daily UTC closes. Incoming crypto transfers use receipt-date performance values; original tax basis is unknown.',
    ...(payload.valuation.estimatedSymbols.length?['Legacy MATIC rewards use explicitly estimated POL/USD daily values where retired MATIC market prices are unavailable (documented 1:1 migration).']:[])];
  result.outcome='warning';return result;
}
module.exports={reconcile};
