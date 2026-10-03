const {decimal,format,assetCode,category,audit} = require('./krakenReconcile');
const FIAT=new Set(['USD','GBP']);
const QUOTES=new Set(['USD','GBP','USDT']);
const day=time=>new Date(Number(time)*1000).toISOString().slice(0,10);
const iso=time=>new Date(Number(time)*1000).toISOString();
function prepare(payload) {
  const check=audit(payload);
  if(check.blockers.length)throw Error(`Kraken reconciliation blocked: ${check.blockers.join('; ')}`);
  if(!payload.valuation?.complete)throw Error('Kraken historical price coverage is incomplete; previous reports were preserved');
  const rates=payload.valuation.rates,rate=(symbol,time)=>{
    const value=symbol==='USD'?1:rates[symbol]?.[day(time)];
    if(!(value>0))throw Error(`Missing Kraken historical price: ${symbol}`);return value;
  };
  const ledger=Object.entries(payload.ledger).map(([id,l])=>({id,...l,symbol:assetCode(l.asset),net:decimal(l.amount)-decimal(l.fee)}));
  const lots=new Map(),trades=[],events=[],handled=new Set();
  const add=(symbol,quantity,cost,time,key,notes=null)=>{
    if(quantity<=0n)return;
    const list=lots.get(symbol)||[];list.push({quantity,cost,time,key,notes});lots.set(symbol,list);
  };
  const take=(symbol,quantity)=>{
    const list=lots.get(symbol)||[],taken=[];let remaining=quantity;
    while(remaining>0n&&list.length) {
      const lot=list[0],used=remaining<lot.quantity?remaining:lot.quantity,cost=lot.cost*Number(used)/Number(lot.quantity);
      taken.push({...lot,quantity:used,cost});lot.cost-=cost;lot.quantity-=used;remaining-=used;
      if(lot.quantity===0n)list.shift();
    }
    if(remaining>0n)throw Error(`Kraken disposal is missing acquisition history: ${symbol} (${format(remaining)})`);
    return taken;
  };
  const settlements=new Map();
  for(const l of ledger.filter(l=>l.type==='trade')){const rows=settlements.get(l.refid)||[];rows.push(l);settlements.set(l.refid,rows);}
  const timeline=[];
  for(const [key,rows] of settlements)timeline.push({time:Math.min(...rows.map(l=>l.time)),key,kind:'trade',rows});
  // Preserve cost through actual broker migrations, even when the two ledger
  // sides arrive hours apart or one side is in a staking wallet.
  const migrations={MATIC:{to:'POL',ratio:1},FTM:{to:'S',ratio:1},EOS:{to:'A',ratio:1},MKR:{to:'SKY',ratio:24000}};
  const conversionRows=ledger.filter(l=>category(l)==='asset_conversion');
  for(const out of conversionRows.filter(l=>l.net<0n)) {
    const migration=migrations[out.symbol];if(!migration)throw Error('Unsupported Kraken token migration');
    const candidates=conversionRows.filter(l=>!handled.has(l.id)&&l.symbol===migration.to&&l.net>0n&&Math.abs(l.time-out.time)<172800&&
      Math.abs(Number(l.net)/Number(-out.net)-migration.ratio)<migration.ratio*1e-7);
    if(candidates.length!==1)throw Error('Kraken token migration does not pair unambiguously');
    const incoming=candidates[0];handled.add(out.id);handled.add(incoming.id);
    timeline.push({kind:'migration',time:Math.min(out.time,incoming.time),key:out.id,out,incoming});
  }
  if(conversionRows.some(l=>!handled.has(l.id)))throw Error('Unpaired Kraken token conversion');
  for(const l of ledger)if(!['spot_settlement','staking_transfer','asset_conversion'].includes(category(l)))
    timeline.push({kind:'ledger',time:l.time,key:l.id,row:l});
  timeline.sort((a,b)=>a.time-b.time||a.key.localeCompare(b.key));
  let marginPnl=0,marginStart=Infinity,marginEnd=0;
  for(const event of timeline) {
    if(event.kind==='migration') {
      const consumed=take(event.out.symbol,-event.out.net);
      let assigned=0n;
      consumed.forEach((lot,index)=>{
        const qty=index===consumed.length-1?event.incoming.net-assigned:lot.quantity*event.incoming.net/(-event.out.net);
        assigned+=qty;add(event.incoming.symbol,qty,lot.cost,lot.time,`${lot.key}:migration:${event.key}`,lot.notes);
      });continue;
    }
    if(event.kind==='trade') {
      const rows=event.rows;
      if(rows.length===1) {
        const l=rows[0];if(FIAT.has(l.symbol))throw Error('Unexpected single fiat settlement');
        if(l.net<0n) {
          // A broker rounding correction changes quantity, preserving total
          // surviving cost. It is not a market sale or an income payment.
          const used=take(l.symbol,-l.net),remaining=lots.get(l.symbol);
          if(remaining?.length)remaining[0].cost+=used.reduce((s,x)=>s+x.cost,0);
        } else if(l.net>0n) {
          const existing=lots.get(l.symbol);if(existing?.length)existing[0].quantity+=l.net;
          else add(l.symbol,l.net,0,l.time,l.id,'Broker native rounding adjustment');
        }
        continue;
      }
      if(rows.length!==2)throw Error('Unsupported Kraken settlement group size');
      if(rows.every(l=>FIAT.has(l.symbol)))continue; // Currency exchange is cashflow, not an investment trade.
      if(rows.some(l=>l.symbol==='USDT')&&rows.some(l=>FIAT.has(l.symbol))) {
        const stable=rows.find(l=>l.symbol==='USDT'),cash=rows.find(l=>FIAT.has(l.symbol));
        if(stable.net>0n)add('USDT',stable.net,Number(-cash.net)/1e16*rate(cash.symbol,cash.time),stable.time,event.key);
        else take('USDT',-stable.net);
        continue;
      }
      const quote=rows.find(l=>QUOTES.has(l.symbol)),base=rows.find(l=>l!==quote);
      if(!quote||!base||QUOTES.has(base.symbol)) {
        // Stablecoin/fiat conversions still create or consume the stablecoin
        // inventory, which belongs in holdings rather than fiat cash.
        throw Error('Unsupported Kraken spot quote currency');
      }
      const value=Number(quote.net<0n?-quote.net:quote.net)/1e16*rate(quote.symbol,event.time);
      if(base.net>0n&&quote.net<0n)add(base.symbol,base.net,value,event.time,event.key);
      else if(base.net<0n&&quote.net>0n) {
        const sold=-base.net;
        for(const lot of take(base.symbol,sold)) {
          const quantity=Number(format(lot.quantity)),proceeds=value*Number(lot.quantity)/Number(sold);
          trades.push({key:`${lot.key}:${event.key}`,symbol:base.symbol,quantity,entryTime:iso(lot.time),exitTime:iso(event.time),
            entryPrice:lot.cost/quantity,exitPrice:proceeds/quantity,pnl:proceeds-lot.cost,notes:lot.notes});
        }
      } else throw Error('Kraken spot settlement signs are inconsistent');
      if(quote.symbol==='USDT'){if(quote.net<0n)take('USDT',-quote.net);else add('USDT',quote.net,value,event.time,event.key+':quote');}
      continue;
    }
    const l=event.row,kind=category(l),value=Number(format(l.net));
    if(kind==='staking_reward') {
      if(l.net<0n)throw Error('Unexpected negative Kraken Earn reward');
      const estimated=payload.valuation.estimatedSymbols.includes(l.symbol);
      const usd=value*rate(l.symbol,l.time);add(l.symbol,l.net,usd,l.time,l.id,estimated
        ? 'Earn/staking reward: estimated POL/USD daily-close value for legacy MATIC (documented 1:1 migration)'
        : 'Earn/staking reward valued at receipt-date daily close');
      events.push({key:l.id,type:'interest',time:l.time,amount:usd,currency:'USD',description:`Kraken Earn/staking: ${l.symbol}; net ${format(l.net)} coins${estimated?'; estimated POL/USD value':''}`});
    } else if(kind==='deposit'||kind==='withdrawal') {
      events.push({key:l.id,type:kind,time:l.time,amount:Number(l.amount),currency:l.symbol,
        amountUsd:Number(l.amount)*rate(l.symbol,l.time),description:`Kraken ${kind}`});
    } else if(kind==='external_crypto_transfer') {
      if(l.net>0n)add(l.symbol,l.net,value*rate(l.symbol,l.time),l.time,l.id,
        'Incoming external transfer valued at receipt-date market value for account performance. Original acquisition/tax basis is unknown.');
      else take(l.symbol,-l.net);
    } else if(kind==='conversion') {
      if(!FIAT.has(l.symbol)){if(l.net>0n)add(l.symbol,l.net,value*rate(l.symbol,l.time),l.time,l.id);else take(l.symbol,-l.net);}
    } else if(kind==='margin_settlement') {
      const usd=value*rate(l.symbol,l.time);marginPnl+=usd;marginStart=Math.min(marginStart,l.time);marginEnd=Math.max(marginEnd,l.time);
      if(!FIAT.has(l.symbol)){if(l.net<0n)take(l.symbol,-l.net);else add(l.symbol,l.net,usd,l.time,l.id);}
    } else throw Error('Unsupported Kraken ledger activity');
  }
  if(marginStart!==Infinity) {
    const opening=Object.values(payload.trades).filter(t=>Number(t.margin)>0&&!String(t.misc).includes('closing'));
    if(opening.length!==1)throw Error('Historical Kraken margin activity requires additional mapping');
    const t=opening[0];
    if(!t.pair.endsWith('USDT')||t.type!=='sell')throw Error('Unsupported historical Kraken margin pair or direction');
    const symbol=assetCode(t.pair.slice(0,-4)),quantity=Number(t.vol),entryPrice=Number(t.price)*rate('USDT',t.time);
    trades.push({key:'margin:'+t.postxid+':'+t.ordertxid,symbol,quantity,side:'short',entryTime:iso(t.time),exitTime:iso(marginEnd),
      entryPrice,exitPrice:entryPrice-marginPnl/quantity,pnl:marginPnl,notes:'Historical closed margin position. P&L is the complete native ledger settlement, including margin and rollover fees, valued at daily closes.'});
  }
  const positions=[];
  const currentBalances=new Map();
  for(const [asset,v] of Object.entries(payload.balances)){const symbol=assetCode(asset);currentBalances.set(symbol,(currentBalances.get(symbol)||0n)+decimal(v.balance));}
  for(const [symbol,list] of lots) {
    const quantity=list.reduce((s,l)=>s+l.quantity,0n),reported=currentBalances.get(symbol)||0n;
    // Native sums are audited exactly above; this gate checks inventory after
    // staking normalization, migrations, rounding and native fee consumption.
    if(quantity!==reported)throw Error(`Kraken reconstructed inventory mismatch: ${symbol} (${format(quantity-reported)})`);
    if(quantity===0n)continue;
    const q=Number(format(quantity)),quote=payload.valuation.current[symbol];if(!quote?.price)throw Error('Missing Kraken current holding quote');
    positions.push({symbol,quantity:q,totalCost:list.reduce((s,l)=>s+l.cost,0),currentValue:q*quote.price,
      instrumentType:'crypto',lotCount:list.length,openedAt:iso(Math.min(...list.map(l=>l.time))),
      notes:list.some(l=>l.notes?.includes('external transfer'))?'Includes external-transfer receipt-date performance basis; original tax basis is unknown.':null});
    if(symbol!=='USDT'&&symbol!=='USDG')for(const lot of list){const q=Number(format(lot.quantity));trades.push({key:lot.key+':open',symbol,quantity:q,
      entryTime:iso(lot.time),exitTime:null,entryPrice:lot.cost/q,exitPrice:null,pnl:null,notes:lot.notes});}
  }
  for(const [symbol,amount] of currentBalances)if(!FIAT.has(symbol)&&amount>0n&&!lots.has(symbol))throw Error('Kraken holding has no reconstructed inventory');
  return {trades,positions,events,check};
}
module.exports={prepare};
