const db=require('../../config/database');
const {assetCode,category}=require('./krakenReconcile');
const day=l=>new Date(Number(l.time)*1000).toISOString().slice(0,10);
function rowsFor(payload,end) {
  const rates=payload.valuation.rates.GBP,rows=new Map(),asOf=payload.asOf.slice(0,10),cutoff=end<asOf?end:asOf;
  const rowFor=date=>{if(!rows.has(date))rows.set(date,{date,trade_inflow:0,trade_outflow:0,fees:0,deposits:0,withdrawals:0,income:0,
    account_fees:0,withholding_tax:0,inflow:0,outflow:0,fx_adjustments:0,usdChange:0,gbpChange:0});return rows.get(date);};
  for(const l of Object.values(payload.ledger)) {
    const date=day(l);if(date>cutoff)continue;
    const symbol=assetCode(l.asset),kind=category(l);
    if(kind==='staking_reward') {
      const rate=payload.valuation.rates[symbol]?.[date];if(!(rate>0))throw Error('Kraken reward valuation unavailable');
      // Rewards are paid in coins. Their income value is shown separately;
      // fiat cash balances must not increase by the reward's USD equivalent.
      rowFor(date).income+=(Number(l.amount)-Number(l.fee))*rate;
    }
    if(!['USD','GBP'].includes(symbol))continue;
    const r=rowFor(date),rate=symbol==='USD'?1:rates?.[date];if(!(rate>0))throw Error('Kraken cash FX rate unavailable');
    const amount=(Number(l.amount)-Number(l.fee))*rate;
    if(symbol==='USD')r.usdChange+=Number(l.amount)-Number(l.fee);else r.gbpChange+=Number(l.amount)-Number(l.fee);
    if(amount>=0)r.inflow+=amount;else r.outflow-=amount;
    if(l.type==='trade'){if(amount>=0)r.trade_inflow+=amount;else r.trade_outflow-=amount;}
    if(kind==='deposit')r.deposits+=Number(l.amount)*rate;
    if(kind==='withdrawal')r.withdrawals-=Number(l.amount)*rate;
    r.fees+=Number(l.fee)*rate;
    if(l.type!=='trade')r.account_fees+=Number(l.fee)*rate;
  }
  if(cutoff>=Object.values(payload.ledger).map(day).sort()[0])rowFor(cutoff);
  let usd=0,gbp=0,previousRate=0;
  return [...rows.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>{
    const rate=rates?.[r.date];if(gbp!==0&&!(rate>0))throw Error('Kraken cash closing FX rate unavailable');
    const fx=gbp*((rate||previousRate)-previousRate);r.fx_adjustments=fx;
    if(fx>=0)r.inflow+=fx;else r.outflow-=fx;
    usd+=r.usdChange;gbp+=r.gbpChange;previousRate=rate||previousRate;
    r.net=r.inflow-r.outflow;r.balance=usd+gbp*previousRate;return r;
  });
}
async function loadLedger(userId,account,start,end) {
  if(account.broker!=='kraken')return null;
  const p=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='kraken' AND account_identifier=$2",
    [userId,account.account_identifier])).rows[0]?.payload;
  if(!p?.reconciled)return null;
  if(account.currency!=='USD')throw Error('Kraken multi-currency cash ledger requires USD reporting currency');
  const rows=rowsFor(p,end);let openingBalance=0;
  for(const r of rows)if(r.date<start)openingBalance=r.balance;
  const reported=Number(p.balances.ZUSD?.balance||0)+Number(p.balances.ZGBP?.balance||0)*p.valuation.current.GBP.price;
  const balance=rows.at(-1)?.balance||0,closed=p.asOf.slice(0,10)<=end;
  return {rows:rows.filter(r=>r.date>=start),openingBalance,balance,source:'kraken_fiat_wallets',fundingPending:false,
    reconciliation:closed?{statementDate:p.asOf.slice(0,10),reportedBalance:reported,calculatedBalance:balance,difference:balance-reported,matched:Math.abs(balance-reported)<.02}:null,
    liveCash:{currency:'USD',amount:reported,asOf:p.valuation.asOf,nativeBalances:{USD:Number(p.balances.ZUSD?.balance||0),GBP:Number(p.balances.ZGBP?.balance||0)},
      source:'Kraken USD and GBP fiat balances. Stablecoins and Earn rewards are included in investments, not fiat cash.'}};
}
async function dayActivity(userId,account,date) {
  const l=await loadLedger(userId,account,date,date);if(!l)return null;
  const p=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='kraken' AND account_identifier=$2",
    [userId,account.account_identifier])).rows[0].payload;
  return {date,trades:[],transactions:Object.entries(p.ledger).filter(([,l])=>day(l)===date&&['USD','GBP'].includes(assetCode(l.asset))).map(([id,l])=>{
    const currency=assetCode(l.asset),rate=currency==='USD'?1:p.valuation.rates.GBP[date],signed=(Number(l.amount)-Number(l.fee))*rate;
    return {id,transactionType:category(l),amount:Math.abs(signed),signedAmount:signed,description:`Kraken ${l.type}: ${currency} wallet`,
      sourceType:'kraken',originalAmount:Number(l.amount)-Number(l.fee),originalCurrency:currency};
  })};
}
module.exports={rowsFor,loadLedger,dayActivity};
