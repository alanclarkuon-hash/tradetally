const db=require('../../config/database');
const AnalyticsCache=require('../analyticsCache');
const {isDeepStrictEqual}=require('util');
const number=(v,label)=>{if(v==null || v==='' || !Number.isFinite(Number(v)))throw new Error(`Incomplete OKX ${label}`);return Number(v);};
const date=ts=>new Date(Number(ts)).toISOString().slice(0,10);
function mergeRows(previous,current,key='billId') {
  const rows=new Map();
  for(const row of [...previous,...current]) {
    if(!row[key])throw new Error('Missing OKX history identity');
    const id=String(row[key]);const old=rows.get(id);
    if(old && !isDeepStrictEqual(old,row))throw new Error('Conflicting OKX history identity');
    rows.set(id,row);
  }
  return [...rows.values()];
}
function prepare(payload,rates,receipts=new Map(),origin=null) {
  if(payload.positions.length || payload.funding.length)throw new Error('OKX Funding balances or derivative positions require additional reconciliation. Previous reports were preserved.');
  const rate=ts=>{const value=rates[date(ts)];if(!(value>0))throw new Error('Missing historical USDT/USD index rate');return value;};
  const byAsset=new Map();
  for(const bill of payload.bills) {
    if(!['1','2'].includes(bill.type) || (bill.type==='1' && !['11','12'].includes(bill.subType)))throw new Error('Unsupported OKX bill type; review required.');
    if(bill.type==='1'&&bill.subType==='12'&&!(number(bill.balChg,'outgoing transfer')<0))throw Error('Invalid OKX outgoing transfer movement');
    const amount=number(bill.balChg,'asset movement');byAsset.set(bill.ccy,(byAsset.get(bill.ccy)||0)+amount);
  }
  const details=payload.trading[0].details;
  for(const p of details)if(Math.abs(number(p.cashBal,'balance')-(byAsset.get(p.ccy)||0))>1e-9)throw new Error('OKX asset balance does not reconcile; no import was applied.');
  for(const [asset,amount] of byAsset)if(!details.some(p=>p.ccy===asset)&&Math.abs(amount)>1e-9)throw new Error('OKX history has an unreported balance');
  const lots=new Map(),trades=[];
  const billTrades=new Map();
  for(const b of payload.bills.filter(b=>b.type==='2')) {
    const key=`${b.instId}:${b.tradeId}`;billTrades.set(key,(billTrades.get(key)||0)+1);
  }
  const fillTrades=new Set(payload.fills.map(f=>`${f.instId}:${f.tradeId}`));
  if([...billTrades].some(([key,count])=>count!==2||!fillTrades.has(key)) ||
    payload.fills.some(f=>billTrades.get(`${f.instId}:${f.tradeId}`)!==2))throw new Error('OKX fills do not match their settlement bills');
  const events=[...payload.bills.filter(b=>b.type==='1'&&b.subType==='11'&&b.ccy!=='USDT').map(b=>({...b,transferIn:true,fillTime:receipts.get(String(b.billId))?.time??b.ts})),...payload.fills,...payload.bills.filter(b=>b.type==='1'&&b.subType==='12'&&b.ccy!=='USDT').map(b=>({...b,transferOut:true,fillTime:b.ts}))];
  for(const f of events.sort((a,b)=>Number(a.fillTime)-Number(b.fillTime)||String(a.billId).localeCompare(String(b.billId)))) {
    if(f.transferIn) {
      const receipt=receipts.get(String(f.billId));
      if(!receipt)throw Error('OKX incoming coin transfer is missing verified acquisition history');
      const assetLots=lots.get(f.ccy)||[];lots.set(f.ccy,assetLots);
      for(const fragment of receipt.lots) {
        const old=assetLots.find(l=>l.id===fragment.id&&l.origin===fragment.origin);
        if(old)old.quantity+=fragment.quantity;else assetLots.push({...fragment});
      }
      assetLots.sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
      continue;
    }
    if(f.transferOut) {
      const assetLots=lots.get(f.ccy)||[];let remaining=-Number(f.balChg);
      while(remaining>1e-12&&assetLots.length){const lot=assetLots[0],used=Math.min(remaining,lot.quantity);lot.quantity-=used;remaining-=used;if(lot.quantity<1e-12)assetLots.shift();}
      if(remaining>1e-10)throw Error('OKX outgoing transfer is missing its acquisition history');
      continue; // Moving owned coins is not a sale or realised profit.
    }
    const [base,quote]=f.instId.split('-');
    if(f.instType!=='SPOT' || quote!=='USDT' || !['buy','sell'].includes(f.side) || ![base,quote].includes(f.feeCcy))throw new Error('Unsupported OKX spot instrument or fee asset');
    const size=number(f.fillSz,'fill size'),price=number(f.fillPx,'fill price'),fee=number(f.fee,'fee');
    if(!(size>0&&price>0))throw new Error('Invalid OKX spot fill');
    const timestamp=new Date(number(f.fillTime,'fill timestamp')).toISOString();
    const fx=rate(f.fillTime);const assetLots=lots.get(base)||[];lots.set(base,assetLots);
    if(f.side==='buy') {
      const quantity=size+(f.feeCcy===base?fee:0),cost=size*price-(f.feeCcy===quote?fee:0);
      if(!(quantity>0&&cost>0))throw new Error('Invalid fee-adjusted OKX acquisition');
      assetLots.push({id:String(f.billId),origin,quantity,unitCost:cost/quantity,fx,time:timestamp,fill:f});
    } else {
      let remaining=size-(f.feeCcy===base?fee:0);
      const sold=remaining,proceeds=size*price+(f.feeCcy===quote?fee:0);
      while(remaining>1e-12&&assetLots.length) {
        const lot=assetLots[0],quantity=Math.min(remaining,lot.quantity),nativeCost=quantity*lot.unitCost,nativeProceeds=proceeds*quantity/sold;
        trades.push({key:`${lot.origin&&lot.origin!==origin?lot.origin+':':''}${lot.id}:${f.billId}`,symbol:base,quantity,entryTime:lot.time,exitTime:timestamp,
          entryPrice:lot.unitCost*lot.fx,exitPrice:nativeProceeds*fx/quantity,pnl:nativeProceeds*fx-nativeCost*lot.fx,
          nativePnl:nativeProceeds-nativeCost,origin:lot.origin,entry:lot.fill,exit:f});
        lot.quantity-=quantity;remaining-=quantity;if(lot.quantity<1e-12)assetLots.shift();
      }
      if(remaining>1e-10)throw new Error('OKX sale is missing its acquisition history');
    }
  }
  for(const [symbol,assetLots] of lots)for(const lot of assetLots)trades.push({key:`${lot.origin&&lot.origin!==origin?lot.origin+':':''}${lot.id}:open`,symbol,quantity:lot.quantity,
    entryTime:lot.time,exitTime:null,entryPrice:lot.unitCost*lot.fx,exitPrice:null,pnl:null,origin:lot.origin,entry:lot.fill});
  const usdtLots=[];
  for(const b of [...payload.bills].filter(x=>x.ccy==='USDT').sort((a,b)=>(receipts.get(String(a.billId))?.time??Number(a.ts))-(receipts.get(String(b.billId))?.time??Number(b.ts)))) {
    const amount=Number(b.balChg);
    if(amount>0){
      const receipt=receipts.get(String(b.billId));
      const added=receipt?.lots||[{id:String(b.billId),origin,quantity:amount,unitCost:1,fx:rate(b.ts),time:new Date(Number(b.ts)).toISOString()}];
      for(const fragment of added){const old=usdtLots.find(l=>l.id===fragment.id&&l.origin===fragment.origin);if(old)old.quantity+=fragment.quantity;else usdtLots.push({...fragment});}
      usdtLots.sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
    }
    else {let remaining=-amount;while(remaining>1e-10&&usdtLots.length){const l=usdtLots[0],used=Math.min(remaining,l.quantity);l.quantity-=used;remaining-=used;if(l.quantity<1e-10)usdtLots.shift();}if(remaining>1e-8)throw new Error('Missing OKX stablecoin history');}
  }
  const positions=details.filter(p=>Number(p.cashBal)>1e-12).map(p=>{
    const quantity=Number(p.cashBal),assetLots=lots.get(p.ccy)||[];
    if(Math.abs(quantity-(p.ccy==='USDT'?usdtLots:assetLots).reduce((s,l)=>s+l.quantity,0))>1e-9)throw new Error('OKX spot holdings do not match the reconstructed lots');
    return {symbol:p.ccy,quantity,totalCost:p.ccy==='USDT'?usdtLots.reduce((s,l)=>s+l.quantity*l.unitCost*l.fx,0):assetLots.reduce((s,l)=>s+l.quantity*l.unitCost*l.fx,0),
      currentValue:number(p.eqUsd,'USD asset value'),instrumentType:'crypto',lotCount:assetLots.length||1,
      openedAt:assetLots[0]?.time||new Date(Math.min(...payload.bills.filter(b=>b.ccy===p.ccy).map(b=>Number(b.ts)))).toISOString(),
      notes:p.ccy==='USDT'?'Stablecoin holding. Verified internal transfers retain original acquisition FX; external transfers use the transfer-date index.':null};
  });
  return {trades,positions};
}
function mergeTransfers(previous,current,key) {
  const rows=new Map(previous.map(r=>[String(r[key]),r]));
  for(const row of current) {
    if(!row[key])throw Error('Missing OKX transfer identity');
    const old=rows.get(String(row[key]));
    if(old) {
      const fields=['ccy','amt','ts'];
      if(String(old.state)==='2')fields.push('state','fee','feeCcy','txId');
      if(fields.some(k=>old[k]!=null&&old[k]!==''&&String(old[k])!==String(row[k])))throw Error('Conflicting OKX transfer history identity');
    }
    rows.set(String(row[key]),row);
  }
  return [...rows.values()];
}
async function reconcile(connection,payload,rates,{dryRun=false,accounts=null}={}) {
  const result={imported:0,updated:0,duplicates:0,skipped:0,failed:0};
  await db.withTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`okx:${connection.userId}`]);
    const group=accounts||[{connection,payload,rates}];
    if(group.some(a=>a.connection.userId!==connection.userId))throw Error('OKX accounts must belong to the same owner');
    if(group.length>1&&(!group[0].payload.verifiedMainUid||group.some(a=>
      String(a.payload.verifiedMainUid)!==String(group[0].payload.verifiedMainUid)||
      String(a.payload.verifiedUid)!==String(a.connection.externalAccountId)||
      (a.connection.brokerEnvironment||'global')!==(connection.brokerEnvironment||'global'))))throw Error('OKX internal transfers require verified accounts in the same main account and region');
    for(const a of group) {
      const connection=a.connection,identifier=`OKX ****${String(connection.externalAccountId).slice(-4)}`;let payload=a.payload;const rates=a.rates;
    const previous=(await client.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='okx' AND account_identifier=$2 FOR UPDATE",[connection.userId,identifier])).rows[0]?.payload;
    payload={...payload,fills:mergeRows(previous?.fills||[],payload.fills),bills:mergeRows(previous?.bills||[],payload.bills),
      deposits:mergeTransfers(previous?.deposits||[],payload.deposits||[],'depId'),
      withdrawals:mergeTransfers(previous?.withdrawals||[],payload.withdrawals||[],'wdId'),
      rates:{...(previous?.rates||{}),...rates}};
      a.payload=payload;
    }
    const receipts=group.length>1?require('./okxTransfers').transferBasis(group.map(a=>({id:a.connection.id,payload:a.payload}))):new Map();
    const prepared=group.map(a=>({...a,mapped:prepare(a.payload,a.payload.rates,receipts.get(a.connection.id),a.connection.id)}));
    for(const a of prepared)if(new Set(a.mapped.trades.map(t=>t.key)).size!==a.mapped.trades.length)throw Error('Duplicate OKX reconstructed lot identity');
    // Validate balances and cost basis for the whole group before importing atomically.
    for(const a of prepared) {
    const connection=a.connection,payload=a.payload,mapped=a.mapped,identifier=`OKX ****${String(connection.externalAccountId).slice(-4)}`;
    const existing=(await client.query("SELECT id,executions FROM trades WHERE user_id=$1 AND broker='okx' AND broker_connection_id=$2 FOR UPDATE",[connection.userId,connection.id])).rows;
    const old=new Map(existing.map(t=>[t.executions?.[0]?.okx_record_key,t]));
    if(existing.some(t=>!t.executions?.[0]?.okx_record_key))throw new Error('Unrecognised OKX journal identity');
    const incoming=new Set(mapped.trades.map(t=>t.key));
    for(const [key,t] of old)if(!incoming.has(key)&&!key.endsWith(':open'))throw new Error('OKX reconciliation would remove a closed trade');
    result.imported+=mapped.trades.filter(t=>!old.has(t.key)).length;result.updated+=mapped.trades.filter(t=>old.has(t.key)).length;
    result.tradeRows=(result.tradeRows||0)+payload.fills.length;result.openPositionRows=(result.openPositionRows||0)+mapped.positions.length;
    if(dryRun)continue;
    let account=(await client.query("SELECT * FROM user_accounts WHERE user_id=$1 AND broker='okx' AND account_identifier=$2 FOR UPDATE",[connection.userId,identifier])).rows;
    if(account.length>1)throw new Error('Multiple managed OKX accounts match this connection');
    if(!account.length)account=(await client.query(`INSERT INTO user_accounts(user_id,account_name,account_identifier,broker,currency,initial_balance,initial_balance_date,notes)
      VALUES($1,$2,$3,'okx','USD',0,$4,$5) RETURNING *`,[connection.userId,connection.accountLabel||'OKX',identifier,
      date(Math.min(...payload.bills.map(b=>Number(b.ts)))),'Coins and stablecoins only. USD is the reporting currency; USDT is not fiat cash.'])).rows;
    if(account[0].currency!=='USD')throw new Error('OKX managed account needs USD reporting currency');
    for(const [key,t] of old)if(!incoming.has(key))await client.query('DELETE FROM trades WHERE user_id=$1 AND id=$2',[connection.userId,t.id]);
    for(const t of mapped.trades) {
      const executions=[{okx_record_key:t.key,okx_native_currency:'USDT',okx_native_pnl:t.nativePnl??null,
        okx_origin_connection_id:t.origin||connection.id,okx_entry:t.entry,okx_exit:t.exit||null,okx_rate_source:'OKX USDT/USD daily UTC index',feesIncluded:true}];
      const values=[connection.userId,t.symbol,(t.exitTime||t.entryTime).slice(0,10),t.entryTime,t.exitTime,t.entryPrice,t.exitPrice,t.quantity,
        t.pnl,t.pnl==null?null:t.pnl/(t.entryPrice*t.quantity)*100,JSON.stringify(executions),connection.id,identifier];
      if(old.has(t.key))await client.query(`UPDATE trades SET symbol=$2,trade_date=$3,entry_time=$4,exit_time=$5,entry_price=$6,exit_price=$7,
        quantity=$8,pnl=$9,pnl_percent=$10,executions=$11::jsonb,broker_connection_id=$12,account_identifier=$13,updated_at=NOW()
        WHERE user_id=$1 AND id=$14`,[...values,old.get(t.key).id]);
      else await client.query(`INSERT INTO trades(user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,pnl,pnl_percent,
        executions,broker_connection_id,account_identifier,broker,side,instrument_type,original_currency,exchange_rate,commission,fees)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,'okx','long','crypto','USD',1,0,0)`,values);
    }
    await client.query(`INSERT INTO broker_portfolio_snapshots(user_id,broker_type,account_identifier,connection_id,positions,synced_at)
      VALUES($1,'okx',$2,$3,$4::jsonb,NOW()) ON CONFLICT(user_id,broker_type,account_identifier)
      DO UPDATE SET positions=EXCLUDED.positions,connection_id=EXCLUDED.connection_id,synced_at=NOW()`,[connection.userId,identifier,connection.id,JSON.stringify(mapped.positions)]);
    payload.historyComplete=true;
    payload.internalTransferBasis=[...(receipts.get(connection.id)||new Map())].map(([billId,receipt])=>({billId,lots:receipt.lots}));
    await client.query(`INSERT INTO broker_import_snapshots(user_id,broker_type,account_identifier,connection_id,payload,captured_at)
      VALUES($1,'okx',$2,$3,$4::jsonb,NOW()) ON CONFLICT(user_id,broker_type,account_identifier)
      DO UPDATE SET payload=EXCLUDED.payload,connection_id=EXCLUDED.connection_id,captured_at=NOW()`,[connection.userId,identifier,connection.id,JSON.stringify(payload)]);
    // An error-state sibling was read live and fully reconciled in this transaction.
    // Recover it only after all group imports succeed; rollback retains failures.
    await client.query(`UPDATE broker_connections SET broker_metadata=broker_metadata || '{"import_pending_review":false}'::jsonb,
      last_sync_status=CASE WHEN connection_status='error' THEN 'success' ELSE last_sync_status END,
      last_sync_at=CASE WHEN connection_status='error' THEN NOW() ELSE last_sync_at END,
      last_sync_message=CASE WHEN connection_status='error' THEN 'Verified OKX account history reconciled with its main/subaccount transfers.' ELSE last_sync_message END,
      consecutive_failures=CASE WHEN connection_status='error' THEN 0 ELSE consecutive_failures END,
      last_error_at=CASE WHEN connection_status='error' THEN NULL ELSE last_error_at END,
      last_error_message=CASE WHEN connection_status='error' THEN NULL ELSE last_error_message END,
      connection_status=CASE WHEN connection_status='error' THEN 'active' ELSE connection_status END,
      updated_at=NOW() WHERE user_id=$1 AND id=$2`,[connection.userId,connection.id]);
    }
    if(!dryRun)await client.query('DELETE FROM analytics_cache WHERE user_id=$1',[connection.userId]);
  });
  if(!dryRun)await AnalyticsCache.invalidate(connection.userId);
  return result;
}
module.exports={prepare,mergeRows,mergeTransfers,reconcile};
