// Reconstruct broker pooled cost without changing FIFO trade identities.
const {sourceFills}=require('./planningLedger');
function settlements(trades) {
 const groups=new Map(),output=new Map();
 for(const t of trades){
  if(t.broker!=='trading212'||t.side!=='long'||(t.instrument_type||'stock')!=='stock')continue;
  const k=[t.account_identifier,t.symbol].join('|');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(t);
 }
 for(const rows of groups.values()){
  const fills=new Map();let invalid=false;
  for(const t of rows)for(const f of sourceFills(t)){
   const raw=t.executions?.[f.sourceIndex],identity=raw?.order_id||raw?.fill_id||raw?.execution_id||raw?.id;
   if(!identity||t.original_entry_price_currency!=null||!f.transactionFx?.accountCurrency||!(f.transactionFx.rate>0)||!f.costsVerified){invalid=true;continue;}
   const key=f.action+'|'+identity,old=fills.get(key);
   if(old&&(old.price!==f.price||old.time!==f.time||old.transactionFx.rate!==f.transactionFx.rate||old.transactionFx.accountCurrency!==f.transactionFx.accountCurrency)){invalid=true;continue;}
   if(!old)fills.set(key,{...f,quantity:0,costs:0,slices:[]});
   const total=fills.get(key);total.quantity+=f.quantity;total.costs+=f.costs;total.slices.push({trade:t,fill:f});
  }
  let units=0,cost=0,fees=0;
  for(const f of [...fills.values()].sort((a,b)=>a.time.localeCompare(b.time)||(a.action==='entry'?-1:1))){
   const rate=f.transactionFx.rate;
   if(f.action==='entry'){units+=f.quantity;cost+=f.quantity*f.price/rate;fees+=f.costs/rate;continue;}
   if(units+1e-8<f.quantity||units<=0)invalid=true;
   const avg=units>0?cost/units:0,feeAvg=units>0?fees/units:0;
   // Broker Result is rounded to account-currency cents, before conversion fees.
   const gross=Math.round((f.quantity*(f.price/rate-avg)+Number.EPSILON)*100)/100;
   const exitFee=f.costs/rate;
   for(const s of f.slices){
    const share=s.fill.quantity/f.quantity;
    const raw=s.trade.executions?.[s.fill.sourceIndex];
    const supplied=raw?.broker_result;
    const authoritative=supplied!=null&&Number.isFinite(Number(supplied))&&raw.broker_result_currency===f.transactionFx.accountCurrency;
    const g=authoritative?Number(supplied):gross*share;
    const entryFee=s.fill.quantity*feeAvg,fee=exitFee*share;
    const event={sourceIndex:s.fill.sourceIndex,sourceKey:s.fill.key,time:s.fill.time,gross_pnl:g,pnl:g-entryFee-fee,commission:0,fees:entryFee+fee};
    if(!output.has(s.trade.id))output.set(s.trade.id,{status:'complete',basis:'broker_pooled_settlement',currency:f.transactionFx.accountCurrency,events:[],pnl:0,commission:0,fees:0});
    const r=output.get(s.trade.id);r.events.push(event);r.pnl+=event.pnl;r.fees+=event.fees;
   }
   cost-=f.quantity*avg;fees-=f.quantity*feeAvg;units-=f.quantity;
  }
  if(invalid)for(const t of rows)if(output.has(t.id))output.set(t.id,{status:'unavailable',currency:output.get(t.id).currency,basis:'broker_pooled_settlement',reason:'Broker pooled-cost history needs reconciliation',pnl:null,events:[]});
 }
 return output;
}
module.exports={settlements};
