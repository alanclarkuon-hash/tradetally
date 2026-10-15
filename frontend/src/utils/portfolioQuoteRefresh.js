const type=row=>row.instrumentType || (row.assetClass==='Crypto assets'?'crypto':'stock');
export const quoteKey=row=>(type(row)==='crypto'?'crypto:':'')+row.symbol;
export const quoteKeys=rows=>[...new Set(rows.filter(r=>['stock','crypto'].includes(type(r))).map(quoteKey).filter(k=>/^(crypto:)?[A-Za-z0-9.^=_!/-]{1,32}$/.test(k)))];
export function applyQuotes(data,payload) {
  if(payload.currency!==data.currency || !(payload.usdRate>0))return data;
  const quotes=new Map((payload.quotes||[]).map(q=>[q.symbol,q]));
  const refresh=row=>{
    if(!['stock','crypto'].includes(type(row)) || !(row.quantity>0))return row;
    const q=quotes.get(quoteKey(row)),time=Date.parse(q?.last_updated),old=Date.parse(row.priceAsOf);
    if(!(Number(q?.current_price)>0) || !Number.isFinite(time) || time>Date.now()+60000 || Number.isFinite(old)&&time<=old)return row;
    // Keep the dashboard display-FX snapshot consistent with its cash and P&L bases.
    const value=row.quantity*Number(q.current_price)*(data.displayUsdRate||payload.usdRate);
    const basis=row.pnlBasis;
    const pnl=basis!=null && Number.isFinite(basis) && basis>=0?value-basis:null;
    return {...row,value,pnl,pnlPercent:pnl!==null&&basis>0?pnl/basis*100:null,priceAsOf:q.last_updated,
      priceStale:Date.now()-time>120000,quoteSource:q.data_source,quoteSession:q.quote_session,
      quoteTimestampKind:q.timestamp_kind||'observed'};
  };
  const holdings=data.holdings.map(refresh),stablecoins=(data.stablecoins||[]).map(refresh);
  const holdingsValue=holdings.reduce((n,h)=>n+(h.value??0),0),stablecoinValue=stablecoins.reduce((n,h)=>n+(h.value??0),0);
  const complete=holdings.every(h=>h.pnl!=null),known=holdings.some(h=>h.pnl!=null)?holdings.reduce((n,h)=>n+(h.pnl??0),0):null;
  const basis=holdings.reduce((n,h)=>n+(h.pnlBasis??0),0);
  return {...data,holdings,stablecoins,quotesRefreshedAt:payload.asOf,
    totals:{...data.totals,holdingsValue,stablecoinValue,portfolioValue:holdingsValue+stablecoinValue+data.totals.cashValue,knownPnl:known,pnl:complete?known:null,pnlPercent:complete&&basis>0?known/basis*100:null},
    coverage:{...data.coverage,missingPrices:[...holdings,...stablecoins].filter(h=>h.value==null).length,missingPnl:holdings.filter(h=>h.pnl==null).length,missingPnlSymbols:holdings.filter(h=>h.pnl==null).map(h=>h.symbol)}};
}
