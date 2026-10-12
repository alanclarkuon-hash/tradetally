const {storedCurrency,calculateNetPosition}=require('../utils/openPositionGrouping');
function recorded(position){
 const lots=(position.trades||[]).flatMap(t=>t._brokerRelatedTrades||[t]).map(t=>({...t,quantity:Math.abs(calculateNetPosition(t))})).filter(t=>t.quantity>1e-8),eligible=['stock','cfd','crypto'].includes(position.instrumentType);
 const covered=lots.filter(t=>Number(t.quantity)>0&&Number(t.stop_loss)>0&&storedCurrency(t)===position.currency&&Number.isFinite(Number(t.entry_price))&&t.side===position.side);
 const quantity=covered.reduce((v,t)=>v+Number(t.quantity),0);
 const complete=eligible&&lots.length>0&&covered.length===lots.length&&Math.abs(quantity-position.totalQuantity)<1e-8;
 return {risk:complete?covered.reduce((v,t)=>v+Number(t.quantity)*Math.max(0,t.side==='short'?Number(t.stop_loss)-Number(t.entry_price):Number(t.entry_price)-Number(t.stop_loss)),0):null,coveredQuantity:quantity,source:'Recorded manual trade stops',asOf:covered.map(t=>t.updated_at).filter(Boolean).sort().at(-1)||null};
}
module.exports={recorded};
