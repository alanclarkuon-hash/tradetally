const db=require('../../config/database');
const {cents}=require('./igStatement');
const dateKey=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
function calculate(report,start,end) {
  const rows=new Map();let balance=cents(report.starting_cash),opening=balance;
  for(const e of report.records) {
    if(e.date>end)continue;
    const r=rows.get(e.date)||{date:e.date,trade_inflow:0,trade_outflow:0,fees:0,deposits:0,withdrawals:0,income:0,account_fees:0,withholding_tax:0,inflow:0,outflow:0,transfer_in:0,transfer_out:0};
    if(e.cash>=0)r.inflow+=e.cash;else r.outflow-=e.cash;
    if(e.type==='trade'){if(e.cash>=0)r.trade_inflow+=e.cash;else r.trade_outflow-=e.cash;}
    if(e.type==='share_trade') {
      const fee=e.shareFees||0;r.fees+=fee;
      if(e.cash>=0){r.trade_inflow+=e.cash+fee;r.inflow+=fee;r.outflow+=fee;}
      else r.trade_outflow+=-e.cash-fee;
    }
    if(e.type==='deposit')r.deposits+=e.cash;
    if(e.type==='withdrawal')r.withdrawals-=e.cash;
    if(e.type==='transfer_in')r.transfer_in+=e.cash;
    if(e.type==='transfer_out')r.transfer_out-=e.cash;
    if(['interest','dividend'].includes(e.type))r.income+=e.cash;
    if(e.type==='account_fee'){r.account_fees-=e.cash;r.fees-=e.cash;}
    if(e.type==='tax')r.withholding_tax-=e.cash;
    balance+=cents(e.cash);if(e.date<start)opening=balance;
    r.net=Math.round((r.inflow-r.outflow)*100)/100;r.balance=balance/100;rows.set(e.date,r);
  }
  const reportDate=dateKey(report.to_date);
  return {rows:[...rows.values()].filter(r=>r.date>=start),openingBalance:opening/100,balance:balance/100,report,source:'ig_statement',fundingPending:false,
    reconciliation:reportDate<=end?{statementDate:reportDate,reportedBalance:Number(report.ending_cash),calculatedBalance:balance/100,
      difference:(balance-cents(report.ending_cash))/100,matched:balance===cents(report.ending_cash)}:null};
}
async function loadLedger(userId,account,start,end) {
  if(account.broker!=='ig')return null;
  const report=(await db.query("SELECT * FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='ig' ORDER BY to_date DESC,updated_at DESC LIMIT 1",[userId,account.id])).rows[0];
  if(!report)return null;
  if(report.currency!==account.currency)throw Error('IG statement/account currency mismatch');
  return calculate(report,start,end);
}
async function dayActivity(userId,account,date) {
  const ledger=await loadLedger(userId,account,date,date);if(!ledger)return null;
  return {date,trades:[],transactions:ledger.report.records.filter(r=>r.date===date).map(r=>({id:r.reference,transactionType:r.type,
    amount:Math.abs(r.cash),signedAmount:r.cash,description:r.description,sourceType:'ig',originalAmount:r.amount,originalCurrency:'GBP'}))};
}
module.exports={calculate,loadLedger,dayActivity};
