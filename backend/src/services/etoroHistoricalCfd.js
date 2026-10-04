// Portfolio equity is posted collateral plus unrealised P&L, not the full
// leveraged exposure. Cash ledger movements already contain fees/income.
function cfdEquity(trade,historicalQuantity,nativeClose,usdPerUnit,{nativeDivisor=1}={}) {
 const entry=(trade.executions||[]).find(e=>e.type==='entry');
 const quantity=Number(trade.quantity),price=Number(trade.entry_price);
 const leverage=Number(entry?.etoro_leverage);
 if(!(quantity>0&&price>=0&&leverage>=1&&nativeClose>0&&usdPerUnit>0&&historicalQuantity>=0)||!['long','short'].includes(trade.side))return null;
 let nativeEntry=entry?.etoro_native_price==null?null:Number(entry.etoro_native_price)/nativeDivisor;
 // API history without a native rate was accepted only after its USD
 // investment independently matched quoted price × units.
 if(nativeEntry==null&&entry?.etoro_record_key?.startsWith('closed:')&&usdPerUnit===1)nativeEntry=price;
 if(nativeEntry==null||!Number.isFinite(nativeEntry)||nativeEntry<0)return null;
 const collateral=price*quantity/leverage;
 const pnl=(historicalQuantity*nativeClose-quantity*nativeEntry)*(trade.side==='long'?1:-1)*usdPerUnit;
 return collateral+pnl;
}
module.exports={cfdEquity};
