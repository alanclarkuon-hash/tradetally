
const crypto = require('crypto');
const {isDeepStrictEqual}=require('node:util');
const {fail} = require('./tradePlanning');
const positive = v => Number.isFinite(Number(v)) && Number(v)>0;
function zeroPriceEvidence(trade,e,kind,capital){
 if(e.price==null||Number(e.price)!==0)return null;
 if(kind==='entry'&&trade.broker==='etoro'&&capital!=null&&e.etoro_statement_source&&e.etoro_capital_basis==='statement_close_cash_and_reported_net')return 'broker_cash_acquisition_basis';
 if(kind==='exit'&&trade.broker==='etoro'&&e.etoro_position_id!=null&&e.etoro_reported_net_profit!=null&&Number.isFinite(Number(e.etoro_reported_net_profit)))return 'broker_reported_zero_value_closure';
 if(kind==='exit'&&trade.broker==='trading212'&&e.order_id!=null&&e.broker_result!=null&&Number.isFinite(Number(e.broker_result))&&/^[A-Z]{3}$/.test(e.broker_result_currency||''))return 'broker_reported_zero_value_closure';
 return null;
}
function sourceFills(trade) {
 let executions=trade.executions;
 if(typeof executions==='string'){try{executions=JSON.parse(executions)}catch{executions=[]}}
 // OKX and Kraken store metadata inside reconciled journal-lot envelopes.
 // Use the normalized lot quantity and USD prices: raw fills can span several
 // journal rows, and fees/USDT conversion are already included in these prices.
 const okx=trade.broker==='okx'&&Array.isArray(executions)&&executions.length===1&&executions[0].okx_record_key&&executions[0].okx_entry&&executions[0].feesIncluded===true;
 const kraken=trade.broker==='kraken'&&Array.isArray(executions)&&executions.length===1&&executions[0].kraken_record_key&&executions[0].feesIncluded===true;
 if(okx||kraken){const metadata=executions[0];const key=String(executions[0][okx?'okx_record_key':'kraken_record_key']);const prefix=trade.broker+':';executions=[
  {id:prefix+key+':entry',order_id:okx?metadata.okx_entry?.ordId:null,action:trade.side==='short'?'sell':'buy',quantity:trade.quantity,price:trade.entry_price,datetime:trade.entry_time,commission:0,fees:0},
  ...(trade.exit_time?[{id:prefix+key+':exit',order_id:okx?metadata.okx_exit?.ordId:null,action:trade.side==='short'?'buy':'sell',quantity:trade.quantity,price:trade.exit_price,datetime:trade.exit_time,commission:0,fees:0}]:[])
 ];}
 const input=Array.isArray(executions)&&executions.length?executions:[
  {action:trade.side==='short'?'sell':'buy',quantity:trade.quantity,price:trade.entry_price,datetime:trade.entry_time,commission:trade.entry_commission??(Number(trade.commission||0)-Number(trade.exit_commission||0)),fees:trade.fees},
  ...(trade.exit_time?[{action:trade.side==='short'?'buy':'sell',quantity:trade.quantity,price:trade.exit_price,datetime:trade.exit_time,commission:trade.exit_commission}]:[])
 ];
 const list=input.flatMap((original,sourceIndex)=>{
  const e={...original,sourceIndex};
  if(e.price!=null&&e.action)return [e];
  if(e.entryPrice==null)return [e];
  const entry={...e,action:trade.side==='short'?'sell':'buy',price:e.entryPrice,datetime:e.entryTime,commission:e.entryCommission??e.commission,fees:e.fees};
  const exit=e.exitPrice!=null?{...e,action:trade.side==='short'?'buy':'sell',price:e.exitPrice,datetime:e.exitTime,commission:e.exitCommission,fees:0}:null;
  if(e.id){entry.id=e.id+':entry';if(exit)exit.id=e.id+':exit'}
  return [entry,...(exit?[exit]:[])];
 });
 // IBKR normalizes commission rebates to negative costs. Admit a signed
 // execution only when broker identities and aggregate cost evidence agree.
 const ibkrSignedCosts=trade.broker==='ibkr'&&(trade.commission!=null||trade.fees!=null)&&list.every(e=>e.execution_id&&Number.isFinite(Number(e.commission||0))&&Number.isFinite(Number(e.fees||e.fee||0)))&&Math.abs(list.reduce((sum,e)=>sum+Number(e.commission||0)+Number(e.fees||e.fee||0),0)-Number(trade.commission||0)-Number(trade.fees||0))<.000001;
 const currency=trade.original_entry_price_currency!=null?'USD':trade.original_currency||null;
 const multiplier=trade.instrument_type==='option'?Number(trade.contract_size):trade.instrument_type==='future'?Number(trade.point_value):1;
 const capital=require('./etoroCapital').entryCapital(trade);
 const fills=list.map(e=>{
  const action=String(e.action||e.side||'').toLowerCase();
  const kind=(trade.side==='short'?action==='sell':action==='buy')?'entry':(trade.side==='short'?action==='buy':action==='sell')?'exit':null;
  const time=e.datetime||e.timestamp||e.execution_time;
  const zeroEvidence=zeroPriceEvidence(trade,e,kind,capital);
  if(!kind||!positive(e.quantity)||(!positive(e.price)&&!zeroEvidence)||!time||!Number.isFinite(new Date(time).getTime())||!positive(multiplier))return null;
  const snapshot={...(zeroEvidence?{zeroPriceEvidence:zeroEvidence}:{}),action:kind,quantity:Number(e.quantity),price:Number(e.price),time:new Date(time).toISOString(),currency,multiplier,
    costs:Number(e.commission||0)+Number(e.fees||e.fee||0),tradeSide:trade.side,instrument:trade.instrument_type||'stock',
    contract:trade.instrument_type==='option'?{symbol:trade.symbol,strike:trade.strike_price,expiry:trade.expiration_date?new Date(trade.expiration_date).toISOString().slice(0,10):'',type:trade.option_type}:null};
  // eToro reports cash credits as negative fees on a closed position. Keep
  // signed source evidence, but admit it only when the broker net verifies it.
  const rawFees=Number(e.fees||e.fee||0),reported=Number(e.etoro_reported_net_profit);
  const brokerGross=(Number(e.price)-Number(trade.entry_price))*Number(e.quantity)*multiplier*(trade.side==='short'?-1:1);
  const verifiedAdjustment=trade.broker==='etoro'&&kind==='exit'&&e.etoro_position_id!=null&&e.etoro_reported_net_profit!=null&&rawFees!==0&&Number(e.commission||0)===0&&Number.isFinite(reported)&&(Math.abs(brokerGross-rawFees-reported)<=.05||Math.abs(brokerGross-reported)<=.05);
  if(!Number.isFinite(snapshot.costs)||(snapshot.costs<0&&!(verifiedAdjustment&&rawFees<0)&&!ibkrSignedCosts))return null;
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const id=e.execution_id||e.executionId||e.fill_id||e.id;
  const accountCurrency=e.account_currency||e.accountCurrency;
  const rawRate=e.broker_fx_rate??e.brokerFxRate;
  const transactionFx=typeof accountCurrency==='string'&&/^[A-Z]{3}$/.test(accountCurrency)?{accountCurrency,rate:accountCurrency===currency?1:positive(rawRate)?Number(rawRate):null}:null;
  const orderId=e.order_id??e.orderId??e.ordId;
  return {...snapshot,...(orderId!=null&&String(orderId).trim()?{orderId:String(orderId)}:{}),...(trade.broker==='etoro'&&e.etoro_position_id!=null&&e.etoro_reported_net_profit!=null&&Number.isFinite(reported)?{brokerReportedNet:reported,brokerLeverage:Number(e.etoro_leverage||1)}:{}),...(kind==='entry'&&capital!=null&&Number(e.etoro_leverage||1)===1?{economicPrice:capital/Number(e.quantity),investedCapital:capital}:{}),sourceIndex:e.sourceIndex,commission:Number(e.commission||0),fees:Number(e.fees||e.fee||0),...(verifiedAdjustment?{cashCredit:Math.max(0,-rawFees),feeCharge:Math.max(0,rawFees),netCosts:Math.abs(brokerGross-reported)<=Math.abs(brokerGross-rawFees-reported)?0:snapshot.costs,netFees:Math.abs(brokerGross-reported)<=Math.abs(brokerGross-rawFees-reported)?0:rawFees}:{}),transactionFx,key:id?'id:'+String(id):'hash:'+fingerprint,fingerprint};
 }).filter(Boolean);
 const totalCosts=fills.reduce((sum,f)=>sum+f.costs,0);
 const aggregateKnown=trade.commission!=null||trade.fees!=null;
 const aggregateCosts=Number(trade.commission||0)+Number(trade.fees||0);
 const costsVerified=!aggregateKnown||Math.abs(totalCosts-aggregateCosts)<.000001;
 fills.forEach(f=>{f.costsVerified=costsVerified;});
 const counts=new Map();fills.forEach(f=>counts.set(f.key,(counts.get(f.key)||0)+1));
 return fills.filter(f=>counts.get(f.key)===1);
}
function verifyAllocation(plan,fill,quantity,used,action,stageKey,trade,assetSymbols=[]) {
 plan=require('./planningManagementRows').forManagement(plan);
 if(!positive(quantity)||quantity+used>fill.quantity+1e-8)fail('Allocation exceeds the available source-fill quantity',409);
 if(fill.action!==action)fail('Choose a matching entry or exit fill');
 const rows=action==='entry'?plan.definition.entries:plan.definition.exits;
 if(!rows.some(r=>r.key===stageKey)&&!(action==='exit'&&stageKey==='runner'))fail('Ladder row not found');
 const symbol=trade.underlying_symbol||trade.symbol;
 if(String(symbol).toUpperCase()!==plan.definition.symbol.toUpperCase()&&!(trade.broker==='trading212'&&plan.definition.instrument==='stock'&&assetSymbols.includes(String(symbol).toUpperCase())))fail('Trade asset does not match this plan');
 const expected=plan.definition.instrument;
 if((trade.instrument_type||'stock')!==expected)fail('Trade instrument does not match this plan');
 if(expected!=='option'&&trade.side!==plan.definition.direction)fail('Trade direction does not match this plan');
 if(expected==='option'){
  const o=plan.definition.options;
  if(!o.contract||!o.strike||!o.expiry)fail('Select an exact option contract before linking executions');
  if(trade.side!=='long'||Number(trade.strike_price)!==o.strike||new Date(trade.expiration_date).toISOString().slice(0,10)!==o.expiry.slice(0,10)||trade.option_type!==o.type||fill.multiplier!==o.multiplier)fail('Option contract does not match the selected contract');
 }
}
function ledger(plan,allocations,trades) {
 plan=require('./planningManagementRows').forManagement(plan);
 const byId=new Map(trades.map(t=>[t.id,t]));let unresolved=0;
 const provisional=[];
 const conversion=plan.provisionalConversion;
 const convert=conversion&&Number.isFinite(conversion.rate)&&conversion.rate>0&&conversion.currency;
 for(const action of ['entry','exit'])for(const [key,row] of Object.entries(plan.management?.[action]||{})){
  if(row.executed&&!allocations.some(a=>a.action===action&&a.stage_key===key)&&positive(row.units)&&positive(row.price)){
   provisional.push({id:'provisional:'+action+':'+key,trade_id:'provisional',source_key:key,stage_key:key,action,quantity:row.units,
    source_snapshot:{action,quantity:row.units,price:convert?row.price*conversion.rate:row.price,time:row.time,currency:convert?conversion.currency:plan.definition.currency,...(convert?{originalPrice:row.price,originalCurrency:plan.definition.currency,fxRate:conversion.rate}:{}),
    multiplier:plan.definition.instrument==='option'?plan.definition.options.multiplier:plan.definition.instrument==='spread_bet'?1/plan.definition.pointSize:1,
    costs:0,tradeSide:plan.definition.instrument==='option'?'long':plan.definition.direction,instrument:plan.definition.instrument,contract:null,transactionFx:{accountCurrency:plan.definition.currency,rate:convert?conversion.rate:1},provisional:true}});
  }
 }
 const records=[...allocations,...provisional].map(a=>{
  const fill=sourceFills(byId.get(a.trade_id)||{}).find(f=>f.key===a.source_key);
  const stored=a.source_snapshot;
  const fxMatches=!Object.hasOwn(stored,'transactionFx')||isDeepStrictEqual(stored.transactionFx,fill?.transactionFx);
  const costEvidenceImproved=stored.costsVerified===false&&fill?.costsVerified===true;
  const capitalMatches=!Object.hasOwn(stored,'investedCapital')||stored.investedCapital===fill?.investedCapital;
  const reportedMatches=!Object.hasOwn(stored,'brokerReportedNet')||stored.brokerReportedNet===fill?.brokerReportedNet;
  const valid=stored.provisional||(fill&&capitalMatches&&reportedMatches&&fill.fingerprint===stored.fingerprint&&(fill.costsVerified===stored.costsVerified||costEvidenceImproved)&&fxMatches);
  const snapshot=valid&&fill?{...stored,...fill}:stored;
  if(!valid)unresolved++;
  return {...a,valid:!!valid,fill:snapshot,quantity:Number(a.quantity)};
 }).sort((a,b)=>a.fill.time.localeCompare(b.fill.time)||(a.action!==b.action?(a.action==='entry'?-1:1):String(a.id).localeCompare(String(b.id))));
 const queues=new Map();let entered=0,exited=0,cost=0,realised=0,entryCost=0,fees=0,overExit=false;
 const currencies=new Set(records.map(a=>a.fill.currency));
 const accountCurrencies=new Set(records.map(a=>a.fill.transactionFx?.accountCurrency||a.fill.currency));
 const accountCurrency=accountCurrencies.size===1?[...accountCurrencies][0]:null;
 let accountCost=0,accountRealised=0,accountEntryCost=0,accountFxMissing=0;
 for(const a of records){
  const f=a.fill,q=a.quantity,fee=(f.netCosts??f.costs)*q/f.quantity;
  const recordAccountCurrency=f.transactionFx?.accountCurrency||f.currency;
  const accountRate=f.transactionFx?f.transactionFx.rate:1;
  if(!accountCurrency||recordAccountCurrency!==accountCurrency||!(accountRate>0))accountFxMissing++;
  a.accountId=require('./planningAccounts').stageAccount(plan.definition,a.action,a.stage_key);
  a.accountKey=a.accountId||byId.get(a.trade_id)?.account_identifier||a.trade_id;
  const economicPrice=f.economicPrice??f.price;
  const accountPrice=accountRate>0?economicPrice*f.multiplier/accountRate:null,accountFee=accountRate>0?fee/accountRate:null;
  a.accountCurrency=recordAccountCurrency;
  const accountKey=a.accountId||byId.get(a.trade_id)?.account_identifier||a.trade_id;
  const key=accountKey+'|'+JSON.stringify(f.contract?[f.contract.type,Number(f.contract.strike),f.contract.expiry]:null)+'|'+f.currency;
  const queue=queues.get(key)||[];queues.set(key,queue);
  if(a.action==='entry'){
   a.positionValue=a.valid&&f.currency&&f.instrument!=='spread_bet'?q*economicPrice*f.multiplier:null;
   a.accountPositionValue=a.valid&&accountPrice!=null&&f.instrument!=='spread_bet'?q*accountPrice:null;
   if(!a.stage_key.startsWith('roll_')&&accountPrice!=null)accountEntryCost+=q*accountPrice;
   entered+=q;if(!a.stage_key.startsWith('roll_'))entryCost+=q*economicPrice*f.multiplier;fees+=fee;queue.push({q,currency:f.currency,price:economicPrice,multiplier:f.multiplier,feePerUnit:fee/q,accountPrice,accountCurrency:recordAccountCurrency,accountFeePerUnit:accountFee==null?null:accountFee/q});
  }else{
   exited+=q;let remaining=q;let gross=0,entryFees=0,accountGross=0,accountEntryFees=0,accountExitValid=accountPrice!=null&&accountFee!=null;
   while(remaining>1e-8&&queue.length){
    const first=queue[0],matched=Math.min(first.q,remaining);
    gross+=matched*(f.tradeSide==='short'?first.price-f.price:f.price-first.price)*first.multiplier;
    if(first.accountPrice==null||first.accountFeePerUnit==null||first.accountCurrency!==recordAccountCurrency)accountExitValid=false;
    else if(accountPrice!=null){accountGross+=matched*(f.tradeSide==='short'?first.accountPrice-accountPrice:accountPrice-first.accountPrice);accountEntryFees+=matched*first.accountFeePerUnit;}
    entryFees+=matched*first.feePerUnit;remaining-=matched;first.q-=matched;if(first.q<=1e-8)queue.shift();
   }
   if(remaining>1e-8)overExit=true;
   a.realisedProfit=gross-entryFees-fee;
   a.accountRealisedProfit=accountExitValid&&remaining<=1e-8?accountGross-accountEntryFees-accountFee:null;
   if(a.accountRealisedProfit!=null)accountRealised+=a.accountRealisedProfit;
   realised+=a.realisedProfit;
  }
 }
 // Broker settlement follows account pooled cost, independent of plan FIFO links.
 for(const a of records.filter(a=>a.action==='exit'&&a.valid&&a.accountRealisedProfit!=null)){
  const result=byId.get(a.trade_id)?.broker_settlement;
  const event=result?.status==='complete'&&result.currency===a.accountCurrency?result.events.find(e=>e.sourceKey===a.source_key):null;
  if(!event)continue;
  const cash=event.pnl*a.quantity/a.fill.quantity;
  accountRealised+=cash-a.accountRealisedProfit;a.accountRealisedProfit=cash;
 }
 // Preserve authoritative native-account cash for fully linked single-exit
 // source trades. Reconstructing their prices can omit broker adjustments.
 // Partial entry allocations retain the allocation ledger's own cost basis.
 const nativeResults=new Map();
 for(const a of records.filter(a=>a.action==='exit'&&a.valid&&a.accountRealisedProfit!=null)) {
  const trade=byId.get(a.trade_id);if(!trade?.exit_time||trade.pnl==null)continue;
  if(!nativeResults.has(trade.id)) {
   const fills=sourceFills(trade),entries=fills.filter(f=>f.action==='entry');
   const fullyLinked=entries.length>0&&fills.filter(f=>f.action==='exit').length===1&&entries.every(f=>Math.abs(records.filter(r=>r.trade_id===trade.id&&r.action==='entry'&&r.source_key===f.key&&r.valid).reduce((s,r)=>s+r.quantity,0)-f.quantity)<1e-8);
   const proportionalEtoro=trade.broker==='etoro'&&fills.filter(f=>f.action==='exit').length===1&&entries.length===1&&records.filter(r=>r.trade_id===trade.id&&r.action==='entry'&&r.valid).reduce((s,r)=>s+r.quantity,0)+1e-8>=records.filter(r=>r.trade_id===trade.id&&r.action==='exit'&&r.valid).reduce((s,r)=>s+r.quantity,0)&&fills.some(f=>f.action==='exit'&&f.brokerLeverage===1&&f.brokerReportedNet!=null&&Math.abs(f.brokerReportedNet-Number(trade.pnl))<1e-8);
   const result=fullyLinked||proportionalEtoro?require('./accountRealisedPnl').calculateAccountResult(trade,a.accountCurrency):null;
   nativeResults.set(trade.id,result?.basis==='account_native'&&result.events.length===1?result:null);
  }
  const result=nativeResults.get(trade.id),event=result?.events[0];
  if(!event)continue;
  const cash=event.pnl*a.quantity/a.fill.quantity;
  accountRealised+=cash-a.accountRealisedProfit;a.accountRealisedProfit=cash;
  if(a.fill.currency===a.accountCurrency){realised+=cash-a.realisedProfit;a.realisedProfit=cash;}
 }
 for(const queue of queues.values())for(const lot of queue){cost+=lot.q*lot.price*lot.multiplier;if(lot.accountPrice!=null)accountCost+=lot.q*lot.accountPrice;}
 const openQuantity=entered-exited;
 const currency=currencies.size===1?[...currencies][0]:null;
 const costsUnresolved=records.filter(a=>a.fill.costsVerified===false).length;
 const complete=records.length>0&&!unresolved&&!overExit&&!costsUnresolved&&currencies.size===1&&!!currency;
 const financialComplete=entered>0&&!unresolved&&!overExit&&!costsUnresolved&&records.every(a=>!!a.fill.currency);
 const accountComplete=financialComplete&&!!accountCurrency&&!accountFxMissing;
 for(const a of records)if(a.action==='exit'){if(!financialComplete)a.realisedProfit=null;if(!financialComplete)a.accountRealisedProfit=null;}
 const accountRisk=plan.baseline?.currency===accountCurrency?plan.baseline.riskBudget:plan.baseline?.originalRiskCurrency===accountCurrency?plan.baseline.originalRisk:null;
 const avg=openQuantity>1e-8?cost/openQuantity/(plan.definition.instrument==='option'?plan.definition.options.multiplier:1):null;
 const stop=Number(plan.definition.stopPrice)*(plan.stopConversion||1);
 const capitalRisk=complete&&(plan.definition.currency===currency||plan.stopConversion)&&['stock','cfd','crypto'].includes(plan.definition.instrument)&&stop>0
  ? [...queues.values()].flat().reduce((s,l)=>s+l.q*Math.max(0,plan.definition.direction==='short'?stop-l.price:l.price-stop)*l.multiplier,0):null;
 // Purchased single-leg options can lose the remaining premium. Keep this
 // conservative bound separate from an unverified underlying-stop estimate.
 const maximumLoss=complete&&plan.definition.instrument==='option'&&records.every(a=>a.fill.tradeSide==='long')
  ?openQuantity>1e-8?Math.max(0,cost+[...queues.values()].flat().reduce((s,l)=>s+l.q*l.feePerUnit,0)-realised):0:null;
 const accounts=[...new Set(records.map(a=>a.accountKey))].map(key=>{
  const own=records.filter(a=>a.accountKey===key),lots=[...queues.entries()].filter(([k])=>k.startsWith(key+'|')).flatMap(([,q])=>q);
  const currencies=new Set(own.map(a=>a.accountCurrency)),currency=currencies.size===1?[...currencies][0]:null;
  const valid=own.every(a=>a.valid&&a.fill.costsVerified!==false)&&currency&&own.filter(a=>a.action==='exit').every(a=>a.accountRealisedProfit!=null);
  const rates={USD:1,...plan.marketRates},cross=(from,to)=>from===to?1:rates[from]>0&&rates[to]>0?rates[to]/rates[from]:null;
  const nativeRisk=financialComplete&&['stock','cfd','crypto'].includes(plan.definition.instrument)&&plan.definition.stopPrice>0&&lots.every(l=>cross(plan.definition.currency,l.currency))?lots.reduce((v,l)=>{const c=cross(plan.definition.currency,l.currency),level=plan.definition.stopPrice*c;return v+l.q*Math.max(0,plan.definition.direction==='short'?level-l.price:l.price-level)*l.multiplier/c},0):null;
  const cashLoss=valid&&plan.definition.instrument==='option'&&own.every(a=>a.fill.tradeSide==='long')?lots.length?Math.max(0,lots.reduce((v,l)=>v+l.q*(l.accountPrice+(l.accountFeePerUnit||0)),0)-own.filter(a=>a.action==='exit').reduce((v,a)=>v+a.accountRealisedProfit,0)):0:null;
  return {capitalRisk:nativeRisk,capitalRiskCurrency:nativeRisk==null?null:plan.definition.currency,maximumLoss:cashLoss,maximumLossCurrency:currency,entryCost:own.filter(a=>a.action==='entry'&&!a.stage_key.startsWith('roll_')).reduce((s,a)=>s+(a.accountPositionValue??0),0),accountId:own[0]?.accountId||null,currency,entered:own.filter(a=>a.action==='entry').reduce((s,a)=>s+a.quantity,0),exited:own.filter(a=>a.action==='exit').reduce((s,a)=>s+a.quantity,0),openQuantity:lots.reduce((s,l)=>s+l.q,0),positionValue:valid&&lots.every(l=>l.accountPrice!=null)?lots.reduce((s,l)=>s+l.q*l.accountPrice,0):null,realisedProfit:valid?own.filter(a=>a.action==='exit').reduce((s,a)=>s+a.accountRealisedProfit,0):null};
 });
 const accountRiskCovered=accounts.length>1&&accounts.every(a=>a.capitalRisk!=null);
 return {capitalRiskCurrency:accountRiskCovered?plan.definition.currency:currency,accounts,maximumLoss,accountOriginalRisk:accountRisk,accountCurrency,accountFxMissing,accountPositionValue:accountComplete?accountCost:null,accountEntryCost:accountComplete?accountEntryCost:null,accountAveragePrice:accountComplete&&openQuantity>1e-8?accountCost/openQuantity/(plan.definition.instrument==='option'?plan.definition.options.multiplier:1):null,accountRealisedProfit:accountComplete?accountRealised:null,accountPercentGain:accountComplete&&accountEntryCost>0?accountRealised/accountEntryCost*100:null,accountRealisedR:accountComplete&&accountRisk>0?accountRealised/accountRisk:null,records,unresolved,overExit,currency,entered,exited,openQuantity,averagePrice:avg,positionValue:cost,
  realisedProfit:complete?realised:null,percentGain:complete&&entryCost>0?realised/entryCost*100:null,
  originalRisk:plan.baseline?.originalRisk??plan.baseline?.riskBudget??null,originalRiskCurrency:plan.baseline?.originalRiskCurrency??plan.baseline?.currency??null,
  realisedR:complete&&(plan.baseline?.originalRiskCurrency||plan.baseline?.currency)===currency&&(plan.baseline?.originalRisk||plan.baseline?.riskBudget)>0?realised/(plan.baseline.originalRisk||plan.baseline.riskBudget):null,
  capitalRisk:accountRiskCovered?accounts.reduce((v,a)=>v+a.capitalRisk,0):capitalRisk,costsUnresolved,provisionalCount:provisional.length,fxEstimated:!!(convert&&provisional.length),economicallyClosed:financialComplete&&!provisional.length&&Math.abs(openQuantity)<1e-8,coverageComplete:financialComplete&&!provisional.length,entryCost,entryFees:fees};
}
module.exports={sourceFills,verifyAllocation,ledger};
