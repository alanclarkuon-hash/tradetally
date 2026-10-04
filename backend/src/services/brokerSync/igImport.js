const db = require('../../config/database');
const crypto = require('crypto');
const {prepare,pairTransfers,cents} = require('./igStatement');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dateKey = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
function openingHash(s) {
  return hash({symbol:s.symbol,entryTime:s.entryTime,entryPrice:s.entryPrice,side:s.side,originalQuantity:s.originalQuantity});
}
function tradeHash(t) {
  if(t.openBet||t.shareLot)return hash({key:t.key,quantity:t.quantity,openingHash:openingHash(t.openingSignature)});
  if(t.shareSettlement)return hash({key:t.key,symbol:t.symbol,entryTime:t.entryTime,exitTime:t.exitTime,entryPrice:t.entryPrice,exitPrice:t.exitPrice,
    quantity:t.quantity,pnl:t.pnl,fees:t.fees,openingKey:t.openingKey,buy:t.shareSettlement.buy,sell:t.shareSettlement.sell});
  if(!t.holding)return hash(t);
  // Monthly valuations can change without changing the acquired holding.
  const {value,asOf,name,symbol,isin,quantity,cost,...extra}=t.holding;
  // JSONB changes object key order. Keep the original acquisition field order
  // so stored fingerprints remain valid when inputs come back from the DB.
  return hash({...t,holding:{name,symbol,isin,quantity,cost,...extra}});
}
function sameCash(a,b,shareMigration=false) {
  // PostgreSQL JSONB reorders keys. Compare financial fields rather than the
  // serialization order, while still refusing changed dates or descriptions.
  return !!a && !!b && ['reference','time','date','amount','cash',...(shareMigration?[]:['type','description'])].every(key=>a[key]===b[key]);
}

async function importAccounts(userId,inputs,{dryRun=true}={}) {
  const accounts = inputs.map(prepare), pairs = pairTransfers(accounts);
  if (new Set(accounts.map(a=>a.identifier)).size !== accounts.length) throw Error('Duplicated IG account identity');
  // Persist dated FX through the existing rate store; missing FX stops import.
  const rates = new Map();
  const statementDates=inputs.flatMap(i=>(i.statementValues||[]).map(p=>p.date));
  for (const date of [...new Set([...statementDates,...accounts.flatMap(a=>[a.confirmation.cutoff.slice(0,10),...a.records.map(r=>r.date),...a.trades.map(t=>(t.exitTime || t.entryTime).slice(0,10)),...(a.confirmation.holdings||[]).map(h=>h.asOf.slice(0,10)),...(a.confirmation.openBets||[]).map(p=>p.asOf.slice(0,10))])])].sort()) {
    const map = await require('../../utils/currencyConverter').getRateMap('USD',date);
    const rate = 1 / Number(map.GBP);
    if (!Number.isFinite(rate) || rate<=0) throw Error('Historical GBP/USD conversion is unavailable');
    rates.set(date,rate);
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ig-file:${userId}`]);
    const result = {dryRun,accounts:[],transfers:pairs.length,importedTrades:0,matchedTrades:0,importedEvents:0,updatedOpenPositions:0,updatedSharePositions:0,closedOpenPositions:0,portfolioDates:0};
    for (const a of accounts) {
      let old = (await client.query("SELECT * FROM user_accounts WHERE user_id=$1 AND broker='ig' AND account_identifier=$2 FOR UPDATE",[userId,a.identifier])).rows;
      if (old.length>1) throw Error('Ambiguous managed IG account');
      if (!old.length) old=(await client.query(`INSERT INTO user_accounts(user_id,account_name,account_identifier,broker,currency,initial_balance,initial_balance_date,notes)
        VALUES($1,$2,$3,'ig','GBP',0,$4,'File imports only. Cash is reconciled to IG statements; transfers are internal funding movements.') RETURNING *`,[userId,a.name,a.identifier,a.from])).rows;
      const account=old[0];
      if (account.currency!=='GBP' || Number(account.initial_balance)!==0 || dateKey(account.initial_balance_date)!==a.from) throw Error('IG opening balance or currency changed; review required');
      const reports=(await client.query("SELECT records FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='ig' FOR UPDATE",[userId,account.id])).rows;
      const current=new Map(a.records.map(r=>[r.reference,r]));
      for(const report of reports) for(const record of report.records) {
        const next=current.get(record.reference);
        const shareMigration=a.kind==='share_dealing'&&record.type==='asset_adjustment'&&next?.type==='share_trade';
        if(!sameCash(next,record,shareMigration)) throw Error('An existing IG cash record changed or full history is missing');
      }
      const previous=(await client.query("SELECT id,executions,exit_time FROM trades WHERE user_id=$1 AND broker='ig' AND account_identifier=$2 FOR UPDATE",[userId,a.identifier])).rows;
      const byKey=new Map(previous.map(t=>[t.executions?.[0]?.ig_record_key,t]));
      if(byKey.size!==previous.length || byKey.has(undefined)) throw Error('Unrecognised existing IG journal entry');
      for(const oldTrade of previous.filter(t=>!a.trades.some(next=>next.key===t.executions[0].ig_record_key))) {
        const e=oldTrade.executions[0],opening=a.openingSignatures.find(o=>(o.openKey||`open:${o.key}`)===e.ig_record_key);
        const verifiedLegacy=opening?.legacyTrade&&e.ig_source_hash===tradeHash(opening.legacyTrade);
        const verifiedDate=opening?.executionVerified&&e.ig_open_share&&e.ig_share_execution_time_verified===false&&
          e.ig_opening_hash===openingHash({...opening.signature,entryTime:e.ig_share_settlement_time});
        if(oldTrade.exit_time||!opening||(!(e.ig_open_bet||e.ig_open_share)&&!verifiedLegacy)||
          (!verifiedLegacy&&!verifiedDate&&e.ig_opening_hash!==openingHash(opening.signature)))throw Error('Full IG trade history is required');
        // Reuse the existing journal ID for the final newly closed portion.
        // This preserves notes, tags and attachments on the open journal row.
        const finalClose=a.trades.filter(t=>t.exitTime&&t.openingKey===opening.key&&!byKey.has(t.key))
          .sort((x,y)=>y.exitTime.localeCompare(x.exitTime))[0];
        if(!finalClose)throw Error('An IG full close needs its new closing record');
        byKey.set(finalClose.key,{...oldTrade,replaceOpen:true});
        result.closedOpenPositions++;
      }
      for(const t of a.trades) {
        const oldTrade=byKey.get(t.key), sourceHash=tradeHash(t);
        if(oldTrade&&!oldTrade.replaceOpen) {
          if(t.shareLot) {
            const prior=oldTrade.executions[0],legacy=t.legacyTrade&&prior.ig_source_hash===tradeHash(t.legacyTrade);
            const verifiedDate=t.shareLot.executionVerified&&prior.ig_open_share&&prior.ig_share_execution_time_verified===false&&
              prior.ig_opening_hash===openingHash({...t.openingSignature,entryTime:prior.ig_share_settlement_time});
            if(oldTrade.exit_time||(!legacy&&!verifiedDate&&(!prior.ig_open_share||prior.ig_opening_hash!==openingHash(t.openingSignature))))throw Error('An IG share acquisition changed; review required');
            if(prior.ig_source_hash!==sourceHash) {
              const rate=rates.get(t.entryTime.slice(0,10));
              const executions=oldTrade.executions.map(e=>({...e,quantity:t.quantity,price:t.entryPrice*rate,datetime:t.entryTime,
                ig_source_hash:sourceHash,ig_open_share:true,ig_share_reference:t.openingKey,ig_opening_hash:openingHash(t.openingSignature),
                ig_share_execution_time_verified:t.shareLot.executionVerified,ig_share_reported_price_gbp:t.shareLot.reportedPriceGBP,
                ig_share_settlement_time:t.shareLot.settlementTime}));
              await client.query(`UPDATE trades SET quantity=$1,entry_time=$2,trade_date=$3,entry_price=$4,exchange_rate=$5,
                original_entry_price_currency=$6,executions=$7::jsonb,
                notes=CASE WHEN notes=$8 OR notes='IG share purchase. Original execution statement not supplied; journal date is the cash settlement date.'
                  THEN $9 ELSE notes END WHERE user_id=$10 AND id=$11 AND exit_time IS NULL`,
                [t.quantity,t.entryTime,t.entryTime.slice(0,10),t.entryPrice*rate,rate,t.entryPrice,JSON.stringify(executions),
                  'IG statement-confirmed holding following share consolidation; cost preserved from cash adjustment.',
                  t.shareLot.executionVerified?'IG share purchase. Cost includes settled charges; trade and cash settlement dates are recorded separately.':
                    'IG share purchase. Original execution statement not supplied; journal date is the cash settlement date.',userId,oldTrade.id]);
              result.updatedSharePositions++;
            }
            result.matchedTrades++;continue;
          }
          if(t.openBet) {
            if(oldTrade.exit_time||!oldTrade.executions[0].ig_open_bet||oldTrade.executions[0].ig_opening_hash!==openingHash(t.openingSignature))throw Error('An IG open-bet acquisition changed; review required');
            if(oldTrade.executions[0].ig_source_hash!==sourceHash) {
              const executions=oldTrade.executions.map(e=>({...e,quantity:t.quantity,ig_source_hash:sourceHash}));
              await client.query('UPDATE trades SET quantity=$1,executions=$2::jsonb WHERE user_id=$3 AND id=$4 AND exit_time IS NULL',
            [t.quantity,JSON.stringify(executions),userId,oldTrade.id]);result.updatedOpenPositions++;
            }
            result.matchedTrades++;continue;
          }
          if(oldTrade.executions[0].ig_source_hash!==sourceHash) {
            // Upgrade the original, statement-confirmed stock fingerprint to
            // exclude valuations; only allow the exact original input here.
            if(!t.holding || oldTrade.executions[0].ig_source_hash!==hash(t)) throw Error('An overlapping IG trade needs review');
            const executions=oldTrade.executions.map(e=>({...e,ig_source_hash:sourceHash}));
            await client.query('UPDATE trades SET executions=$1::jsonb WHERE user_id=$2 AND id=$3',[JSON.stringify(executions),userId,oldTrade.id]);
          }
          result.matchedTrades++;continue;
        }
        const rate=rates.get((t.exitTime || t.entryTime).slice(0,10));
        const common={ig_record_key:t.key,ig_source_hash:sourceHash,ig_market:t.market,ig_opening_reference:t.openingKey,
          ig_reported_total_gbp:t.sourceTotal,ig_original_currency:'GBP',ig_file_source:true,
          ...(t.openBet?{ig_open_bet:true,ig_opening_hash:openingHash(t.openingSignature)}:{}),
          ...(t.shareLot?{ig_open_share:true,ig_share_reference:t.openingKey,ig_opening_hash:openingHash(t.openingSignature),
            ig_share_execution_time_verified:t.shareLot.executionVerified,ig_share_reported_price_gbp:t.shareLot.reportedPriceGBP,
            ig_share_settlement_time:t.shareLot.settlementTime}:{})};
        const executions=[{...common,type:'entry',action:t.side==='long'?'buy':'sell',quantity:t.quantity,
          price:t.entryPrice*rate,datetime:t.entryTime,ig_native_level:t.entryPrice}];
        if(t.exitTime) executions.push({...common,type:'exit',action:t.side==='long'?'sell':'buy',quantity:t.quantity,
          price:t.exitPrice*rate,datetime:t.exitTime,realized_pnl:t.pnl*rate,ig_native_level:t.exitPrice});
        if(oldTrade?.replaceOpen) {
          const updated=await client.query(`UPDATE trades SET trade_date=$1,entry_time=$2,exit_time=$3,entry_price=$4,exit_price=$5,
            quantity=$6,pnl=$7,fees=$8,exchange_rate=$9,original_entry_price_currency=$10,original_exit_price_currency=$11,
            original_pnl_currency=$12,original_fees_currency=$13,executions=$14::jsonb
            WHERE user_id=$15 AND id=$16 AND exit_time IS NULL`,
            [(t.exitTime||t.entryTime).slice(0,10),t.entryTime,t.exitTime,t.entryPrice*rate,t.exitPrice*rate,
              t.quantity,t.pnl*rate,t.fees*rate,rate,t.entryPrice,t.exitPrice,t.pnl,t.fees,JSON.stringify(executions),userId,oldTrade.id]);
          if(updated.rowCount!==1)throw Error('An IG open-bet record changed during import');
          continue;
        }
        await client.query(`INSERT INTO trades(user_id,symbol,trade_date,entry_time,exit_time,entry_price,exit_price,quantity,side,pnl,fees,commission,
          broker,account_identifier,instrument_type,original_currency,exchange_rate,original_entry_price_currency,original_exit_price_currency,
          original_pnl_currency,original_fees_currency,executions,notes,enrichment_status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,'ig',$12,$13,'GBP',$14,$15,$16,$17,$18,$19::jsonb,$20,'completed')`,
          [userId,t.symbol,(t.exitTime||t.entryTime).slice(0,10),t.entryTime,t.exitTime,t.entryPrice*rate,
            t.exitPrice==null?null:t.exitPrice*rate,t.quantity,t.side,t.pnl==null?null:t.pnl*rate,t.fees*rate,a.identifier,t.type,rate,
            t.entryPrice,t.exitPrice,t.pnl,t.fees,JSON.stringify(executions),t.type==='spread_bet'
              ?(t.openBet?`IG remaining open stake: ${t.market}. Quantity is GBP per point; funding stays in cashflow until allocated by the closed report.`:
                `IG spread bet: ${t.market}. Quantity is GBP stake per point. Reported settled P&L includes funding/borrowing/stop fees; dividends are separate income.`)
              :'IG share purchase or sale. Cost and proceeds include settled charges; cashflow retains the separate settlement date.']);
        result.importedTrades++;
      }
      for(const e of a.records.filter(r=>!['trade','asset_adjustment','share_trade'].includes(r.type))) {
        const oldEvent=(await client.query("SELECT amount,event_type,event_date FROM broker_cash_events WHERE user_id=$1 AND account_id=$2 AND broker_type='ig' AND reference_id=$3",[userId,account.id,e.reference])).rows[0];
        if(oldEvent && (cents(oldEvent.amount)!==cents(e.amount) || oldEvent.event_type!==e.type || dateKey(oldEvent.event_date)!==e.date)) throw Error('Existing IG cash event changed');
        const insert=await client.query(`INSERT INTO broker_cash_events(user_id,account_id,broker_type,reference_id,event_type,event_date,amount,currency,amount_usd,description,metadata)
          VALUES($1,$2,'ig',$3,$4,$5,$6,'GBP',$7,$8,$9::jsonb) ON CONFLICT(user_id,account_id,broker_type,reference_id) DO NOTHING`,
          [userId,account.id,e.reference,e.type,e.date,e.amount,e.amount*rates.get(e.date),e.description,JSON.stringify({source:'ig_file',time:e.time,internalTransfer:e.type.startsWith('transfer_')})]);
        result.importedEvents+=insert.rowCount;
      }
      await client.query(`INSERT INTO broker_cash_reports(user_id,account_id,broker_type,from_date,to_date,currency,starting_cash,ending_cash,records)
        VALUES($1,$2,'ig',$3,$4,'GBP',0,$5,$6::jsonb) ON CONFLICT(user_id,account_id,broker_type,from_date,to_date)
        DO UPDATE SET ending_cash=EXCLUDED.ending_cash,records=EXCLUDED.records,updated_at=NOW()`,[userId,account.id,a.from,a.to,a.endingCash,JSON.stringify(a.records)]);
      const stockLots = a.trades.filter(t=>t.holding).map(t=>{
        const rate=rates.get(t.entryTime.slice(0,10)),valuationRate=rates.get(t.holding.asOf.slice(0,10));
        // Statement prices are explicitly dated, never presented as live quotes.
        return {symbol:t.symbol,quantity:t.quantity,totalCost:t.entryPrice*t.quantity*rate,
          currentValue:Number(t.holding.value)*valuationRate,instrumentType:'stock',openedAt:t.entryTime,
          notes:'IG monthly statement valuation; updated by file import',lotCount:1};
      });
      const groupedHoldings=new Map();
      for(const p of stockLots) {
        const previous=groupedHoldings.get(p.symbol);
        if(previous){previous.quantity+=p.quantity;previous.totalCost+=p.totalCost;previous.currentValue+=p.currentValue;previous.lotCount++;
          if(p.openedAt<previous.openedAt)previous.openedAt=p.openedAt;}
        else groupedHoldings.set(p.symbol,{...p});
      }
      const holdings=[...groupedHoldings.values()];
      for(const t of a.trades.filter(t=>t.openBet)) {
        const p=t.openBet,rate=rates.get(p.asOf.slice(0,10));
        holdings.push({symbol:t.symbol,quantity:t.quantity,side:t.side,instrumentType:'spread_bet',
          totalCost:p.entryLevel*t.quantity*rate,currentValue:p.notional*rate,unrealizedPnL:p.unrealizedPnL*rate,
          openedAt:t.entryTime,lotCount:1,betId:p.betId,asOf:p.asOf,
          notes:'IG dated spread-bet valuation. Quantity is GBP stake per point; notional value is not invested cash.'});
      }
      await client.query(`INSERT INTO broker_portfolio_snapshots(user_id,broker_type,account_identifier,positions,synced_at)
        VALUES($1,'ig',$2,$3::jsonb,$4) ON CONFLICT(user_id,broker_type,account_identifier)
        DO UPDATE SET positions=EXCLUDED.positions,synced_at=EXCLUDED.synced_at`,
        [userId,a.identifier,JSON.stringify(holdings),a.confirmation.openBets?.[0]?.asOf || a.confirmation.holdings?.[0]?.asOf || a.confirmation.cutoff]);
      await client.query(`INSERT INTO broker_import_snapshots(user_id,broker_type,account_identifier,payload,captured_at)
        VALUES($1,'ig',$2,$3::jsonb,NOW()) ON CONFLICT(user_id,broker_type,account_identifier)
        DO UPDATE SET payload=EXCLUDED.payload,captured_at=NOW()`,
        [userId,a.identifier,JSON.stringify({igFileInput:inputs.find(input=>prepare(input).identifier===a.identifier)})]);
      await require('./igNavHistory').saveConfirmation(client,userId,a,rates);
      result.portfolioDates++;
      for(const point of inputs.find(i=>prepare(i).identifier===a.identifier).statementValues||[]) {
        await require('./igNavHistory').savePoint(client,userId,a.identifier,point,1/rates.get(point.date));
        result.portfolioDates++;
      }
      result.accounts.push({name:a.name,cash:a.endingCash,closedTrades:a.trades.filter(t=>t.exitTime).length,holdings:a.trades.filter(t=>!t.exitTime).length});
    }
    for(const {out,incoming} of pairs) {
      const previous=(await client.query(`SELECT * FROM broker_transfer_matches WHERE user_id=$1 AND
        ((source_broker='ig' AND source_account=$2 AND source_reference=$3) OR (destination_broker='ig' AND destination_account=$4 AND destination_reference=$5))`,[userId,out.account,out.reference,incoming.account,incoming.reference])).rows;
      if(previous.length) {
        if(previous.length!==1 || previous[0].destination_reference!==incoming.reference || previous[0].source_reference!==out.reference
          || previous[0].destination_account!==incoming.account || previous[0].source_account!==out.account || cents(previous[0].quantity)!==-cents(out.amount)) throw Error('Existing IG transfer link changed');
        continue;
      }
      await client.query(`INSERT INTO broker_transfer_matches(user_id,source_broker,source_account,source_reference,destination_broker,destination_account,destination_reference,
        asset,quantity,source_fee,sent_at,received_at,match_method) VALUES($1,'ig',$2,$3,'ig',$4,$5,'GBP',$6,0,$7,$8,'unique_amount_time')`,
        [userId,out.account,out.reference,incoming.account,incoming.reference,-out.amount,out.time,incoming.time]);
    }
    if(!dryRun) await client.query('DELETE FROM analytics_cache WHERE user_id=$1',[userId]);
    await client.query(dryRun?'ROLLBACK':'COMMIT');
    if(!dryRun) await require('../analyticsCache').invalidate(userId);
    return result;
  } catch(error) { await client.query('ROLLBACK');throw error; }
  finally {client.release();}
}
module.exports={importAccounts,sameCash,tradeHash,openingHash};
