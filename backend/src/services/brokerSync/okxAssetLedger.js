const db=require('../../config/database');
function rowsFor(payload,end) {
  const days=new Map();
  const rowFor=date=>{if(!days.has(date))days.set(date,{date,trade_inflow:0,trade_outflow:0,fees:0,deposits:0,withdrawals:0,income:0,account_fees:0,withholding_tax:0,inflow:0,outflow:0,fx_adjustments:0,nativeChange:0});return days.get(date);};
  for(const b of payload.bills) {
    const date=new Date(Number(b.ts)).toISOString().slice(0,10);if(date>end)continue;
    const rate=payload.rates[date];if(!(rate>0))throw new Error('Missing OKX wallet valuation rate');
    const r=rowFor(date);
    if(b.ccy==='USDT') {
      const amount=Number(b.balChg)*rate;r.nativeChange+=Number(b.balChg);
      if(amount>=0)r.inflow+=amount;else r.outflow-=amount;
      if(b.type==='2'){if(amount>=0)r.trade_inflow+=amount;else r.trade_outflow-=amount;}
    }
    if(b.type==='2'&&Number(b.fee))r.fees-=Number(b.fee)*(b.ccy==='USDT'?1:Number(b.px))*rate;
  }
  const asOf=String(payload.asOf).slice(0,10);
  if(asOf<=end&&payload.rates[asOf])rowFor(asOf);
  let quantity=0,previousRate=0;
  return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>{
    const rate=payload.rates[r.date],fx=quantity*(rate-previousRate);
    r.fx_adjustments=fx;if(fx>=0)r.inflow+=fx;else r.outflow-=fx;
    quantity+=r.nativeChange;previousRate=rate;r.net=r.inflow-r.outflow;r.balance=quantity*rate;
    return r;
  });
}
async function loadLedger(userId,account,start,end) {
  if(account.broker!=='okx')return null;
  const snapshot=(await db.query("SELECT payload FROM broker_import_snapshots WHERE user_id=$1 AND broker_type='okx' AND account_identifier=$2",[userId,account.account_identifier])).rows[0];
  if(!snapshot?.payload.historyComplete)return null;
  const p=snapshot.payload,rows=rowsFor(p,end);let openingBalance=0;
  for(const r of rows)if(r.date<start)openingBalance=r.balance;
  const usdt=p.trading[0].details.find(x=>x.ccy==='USDT'),reported=Number(usdt?.eqUsd||0),balance=rows.at(-1)?.balance||0;
  const asOf=p.asOf.slice(0,10);
  return {rows:rows.filter(r=>r.date>=start),openingBalance,balance,report:p,source:'okx_usdt_wallet',fundingPending:false,
    reconciliation:asOf<=end?{statementDate:asOf,reportedBalance:reported,calculatedBalance:balance,difference:balance-reported,matched:Math.abs(balance-reported)<.02}:null};
}
async function dayActivity(userId,account,date) {
  const ledger=await loadLedger(userId,account,date,date);if(!ledger)return null;
  return {date,trades:[],transactions:ledger.report.bills.filter(b=>b.ccy==='USDT'&&new Date(Number(b.ts)).toISOString().slice(0,10)===date).map(b=>{
    const amount=Number(b.balChg)*ledger.report.rates[date];return {id:b.billId,transactionType:b.type==='1'?'crypto_transfer':'spot_trade',
      amount:Math.abs(amount),signedAmount:amount,description:b.type==='1'?'USDT transfer into Trading wallet':'USDT settlement: '+b.instId,
      sourceType:'okx',originalAmount:Number(b.balChg),originalCurrency:'USDT'};
  })};
}
module.exports={rowsFor,loadLedger,dayActivity};
