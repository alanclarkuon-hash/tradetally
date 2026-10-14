// Public predecessor/successor identity, separate from broker executions.
const conversions=[{
 symbol:'AVB',successor:'VMRK',issuer:'AvalonBay Communities, Inc.',exchange:'NYSE',currency:'USD',date:'2026-08-17',ratio:2.793,
 source:'https://www.sec.gov/Archives/edgar/data/915912/000110465926097833/tm2623381d1_8k.htm'
}];
function conversionFor(data) {
 return conversions.find(e=>data.ticker===e.symbol&&data.name===e.issuer&&data.exchange===e.exchange&&data.currency===e.currency)||null;
}
function proof(data,cached) {
 const event=conversionFor(data);
 if(!event||data.unadjustedAfter!=='1900-01-01'||cached?.currency!==event.currency)return null;
 const splits=cached.splits||[];
 if(splits.length!==1||splits[0].date!==event.date||Math.abs(splits[0].ratio-event.ratio)>1e-9)return null;
 const native=new Map((cached.prices||[]).map(p=>[p.date,Number(p.close)]));
 const candidates=data.prices.filter(p=>p.date<event.date&&Number.isFinite(p.close)&&p.close>0);
 const overlap=candidates.filter(p=>native.has(p.date)&&Number.isFinite(native.get(p.date))&&native.get(p.date)>0);
 // A documented exchange ratio alone does not establish a provider's price units.
 // Require independent native closes on three dates, and reject every conflict.
 if(new Set(overlap.map(p=>p.date)).size<3||overlap.some(p=>Math.abs(native.get(p.date)/(p.close*event.ratio)-1)>0.02))return null;
 const dates=candidates.map(p=>p.date).sort();
 return {symbol:event.symbol,successor:event.successor,conversionDate:event.date,ratio:event.ratio,source:event.source,
   provider:data.source,from:dates[0],to:dates.at(-1),nativeAnchorCount:overlap.length};
}
function covers(symbol,date,value) {
 const event=conversions.find(e=>e.symbol===symbol);
 return !!(event&&value&&value.symbol===symbol&&value.successor===event.successor&&value.conversionDate===event.date&&value.ratio===event.ratio&&value.source===event.source&&
   /^stockanalysis:(tiingo|spg|spg-api)$/.test(value.provider||'')&&Number.isInteger(value.nativeAnchorCount)&&value.nativeAnchorCount>=3&&
   /^\d{4}-\d{2}-\d{2}$/.test(value.from||'')&&/^\d{4}-\d{2}-\d{2}$/.test(value.to||'')&&value.to<event.date&&value.from<=date&&date<=value.to);
}
module.exports={conversionFor,proof,covers};
