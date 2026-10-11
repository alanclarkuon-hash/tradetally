// Account realised cash is a fixed transaction result. Reporting FX is separate.
const {sourceFills}=require('./planningLedger');
const {computeTradePnl}=require('./pnlEngine');
const {tradeBaseCurrency}=require('../utils/tradeFx');
const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
function calculateAccountResult(trade, configuredCurrency) {
 const native=tradeBaseCurrency(trade);
 const fills=sourceFills(trade);
 const currencies=[...new Set(fills.map(f=>f.transactionFx?.accountCurrency).filter(Boolean))];
 const currency=String(configuredCurrency||currencies[0]||native).toUpperCase();
 const unavailable=reason=>({status:'unavailable',currency,nativeCurrency:native,reason,pnl:null,events:[]});
 if(currencies.some(c=>c!==currency))return unavailable('Account currency conflicts with broker execution metadata');
 const multiplier=trade.instrument_type==='option'?Number(trade.contract_size||100):trade.instrument_type==='future'?Number(trade.point_value||1):1;
 if(currency===native) {
  return {status:'complete',currency,nativeCurrency:native,basis:'account_native',pnl:trade.pnl==null?null:Number(trade.pnl),
   commission:Number(trade.commission||0),fees:Number(trade.fees||0),entryCost:Number(trade.entry_price||0)*Number(trade.quantity||0)*multiplier,
   events:Array.isArray(trade.executions)&&trade.executions.length?computeTradePnl({side:trade.side,instrumentType:trade.instrument_type,contractSize:trade.contract_size,pointValue:trade.point_value,executions:trade.executions,fallbackCommission:trade.commission,fallbackFees:trade.fees}).annotatedExecutions.flatMap((e,sourceIndex)=>e.realized_pnl==null?[]:[{sourceIndex,time:e.exitTime||e.exit_time||e.datetime,pnl:e.realized_pnl,gross_pnl:e.gross_realized_pnl}]):trade.exit_time&&trade.pnl!=null?[{time:trade.exit_time,pnl:Number(trade.pnl),gross_pnl:Number(trade.pnl)+Number(trade.commission||0)+Number(trade.fees||0)}]:[]};
 }
 if(!fills.length||fills.some(f=>f.costsVerified===false))return unavailable('Execution prices or costs need reconciliation');
 const accountFills=[];
 for(const f of fills) {
  let rate=f.transactionFx?.rate;
  // Converted legacy imports scaled all execution amounts by the preserved
  // import rate; move their broker source/account rate into the stored base.
  if(native==='USD'&&trade.original_entry_price_currency!=null&&trade.original_currency!=='USD'&&positive(trade.exchange_rate)) {
   if(positive(rate))rate*=Number(trade.exchange_rate);
   else if(trade.original_currency===currency)rate=Number(trade.exchange_rate);
  }
  if(!positive(rate))return unavailable('Broker transaction FX missing');
  accountFills.push({action:f.action==='entry'?(trade.side==='short'?'sell':'buy'):(trade.side==='short'?'buy':'sell'),quantity:f.quantity,
   price:f.price/Number(rate),commission:f.commission/Number(rate),fees:f.fees/Number(rate),datetime:f.time,sourceIndex:f.sourceIndex,sourceKey:f.key});
 }
 const result=computeTradePnl({side:trade.side,instrumentType:trade.instrument_type||'stock',contractSize:trade.contract_size,pointValue:trade.point_value,executions:accountFills,timezone:'UTC'});
 const exits=result.annotatedExecutions.filter(e=>e.realized_pnl!=null);
 const availableEntries=fills.filter(f=>f.action==='entry').reduce((s,f)=>s+f.quantity,0),exited=fills.filter(f=>f.action==='exit').reduce((s,f)=>s+f.quantity,0);
 if(exited>availableEntries+1e-8)return unavailable('Exit quantity exceeds matched entries');
 return {status:'complete',currency,nativeCurrency:native,basis:'broker_transaction_fx',pnl:result.aggregate.pnl,
  commission:result.aggregate.commission,fees:result.aggregate.fees,
  entryCost:accountFills.filter(e=>(trade.side==='short'?e.action==='sell':e.action==='buy')).reduce((s,e)=>s+e.quantity*e.price*multiplier,0),
  events:exits.map(e=>({time:e.datetime,sourceIndex:e.sourceIndex,sourceKey:e.sourceKey,pnl:e.realized_pnl,gross_pnl:e.gross_realized_pnl}))};
}
module.exports={calculateAccountResult};
