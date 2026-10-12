// Project original broker settlements onto matched records for reporting only.
// A detached portion belongs to the broker sale, never to its former buy plan.
const {originalSettlementReports}=require('./planBrokerFills');
function reportingSettlements(groups) {
 const {legacy,canonical}=originalSettlementReports(groups);
 const output=new Map(legacy),events=new Map(),unsupported=new Map();
 for(const g of groups) {
  const report=canonical.get(g.key);
  const parts=g.parts.filter(p=>!p.detached);
  if(!g.valid||(g.fill.action==='exit'&&report?.status!=='complete')) {
   for(const p of parts)unsupported.set(p.tradeId,g.fill.transactionFx?.accountCurrency);
   continue;
  }
  // Attribute the complete sale once across its remaining matched records.
  // This includes detached quantity in the cash settlement, without restoring
  // matching, changing holdings, or making a former entry appear sold.
  const represented=parts.reduce((s,p)=>s+p.quantity,0);
  for(const p of parts) {
   if(!events.has(p.tradeId))events.set(p.tradeId,{currency:g.fill.transactionFx?.accountCurrency,events:[]});
   const target=events.get(p.tradeId);
   if(target.currency!==g.fill.transactionFx?.accountCurrency){unsupported.set(p.tradeId,g.fill.transactionFx?.accountCurrency);continue;}
   if(g.fill.action!=='exit')continue;
   const share=p.quantity/represented,e=report.events[0];
   target.events.push({...e,sourceIndex:p.index,sourceKey:p.key,brokerExecutionKey:g.key,
    brokerQuantity:g.quantity,reportingQuantity:p.quantity,gross_pnl:e.gross_pnl*share,
    pnl:e.pnl*share,fees:e.fees*share,commission:(e.commission||0)*share});
  }
 }
 for(const [id,r]of events)if(!unsupported.has(id))output.set(id,{...r,status:'complete',basis:'original_broker_execution',
  pnl:r.events.reduce((s,e)=>s+e.pnl,0),fees:r.events.reduce((s,e)=>s+e.fees,0),commission:r.events.reduce((s,e)=>s+e.commission,0)});
 for(const [id,currency]of unsupported)output.set(id,{status:'unavailable',currency,basis:'original_broker_execution',pnl:null,events:[],reason:'Original broker settlement evidence needs reconciliation'});
 return output;
}
module.exports={reportingSettlements};
