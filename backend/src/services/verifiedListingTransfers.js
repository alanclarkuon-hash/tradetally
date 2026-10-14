// A venue transfer is not an IPO or a change of share units. Keep this public
// continuity evidence separate from broker records and adjusted price feeds.
const transfers=[{symbol:'ET',issuer:'Energy Transfer LP',fromExchange:'NYSE',toExchange:'TXSE',currency:'USD',date:'2026-10-05',
 source:'https://www.sec.gov/Archives/edgar/data/1276187/000127618726000044/et-20260903.htm'}];
const key=s=>String(s).replace(/\.US$/i,'').toUpperCase();
function eventFor(data){return transfers.find(e=>key(data.ticker)===e.symbol&&data.name===e.issuer&&data.exchange===e.toExchange&&data.currency===e.currency)||null;}
function proof(data,cached){
 const event=eventFor(data);
 if(!event||cached?.currency!==event.currency||!/^stockanalysis:(tiingo|spg|spg-api)$/.test(data.source||'')||!/^\d{4}-\d{2}-\d{2}$/.test(data.unadjustedAfter||''))return null;
 // The statistics page proves the last split; independent native closes prove
 // that the continuous source is on the same unadjusted per-unit basis.
 if((cached.splits||[]).some(s=>s.date>data.unadjustedAfter))return null;
 const candidates=data.prices.filter(p=>p.date>=data.unadjustedAfter&&Number.isFinite(p.close)&&p.close>0),native=new Map((cached.prices||[]).map(p=>[p.date,Number(p.close)]));
 const overlap=candidates.filter(p=>native.has(p.date));
 if(new Set(overlap.map(p=>p.date)).size<3||overlap.some(p=>!(native.get(p.date)>0)||Math.abs(native.get(p.date)/p.close-1)>.02))return null;
 const dates=candidates.filter(p=>p.date<event.date).map(p=>p.date).sort();if(!dates.length)return null;
 return {kind:'exchange-transfer',...event,provider:data.source,unadjustedAfter:data.unadjustedAfter,from:dates[0],to:dates.at(-1),nativeAnchorCount:overlap.length};
}
function covers(symbol,date,value){
 const e=transfers.find(e=>e.symbol===key(symbol));
 return !!(e&&value?.kind==='exchange-transfer'&&['symbol','issuer','fromExchange','toExchange','currency','date','source'].every(k=>value[k]===e[k])&&
 /^stockanalysis:(tiingo|spg|spg-api)$/.test(value.provider||'')&&Number.isInteger(value.nativeAnchorCount)&&value.nativeAnchorCount>=3&&
 /^\d{4}-\d{2}-\d{2}$/.test(value.unadjustedAfter||'')&&/^\d{4}-\d{2}-\d{2}$/.test(value.from||'')&&/^\d{4}-\d{2}-\d{2}$/.test(value.to||'')&&
 value.unadjustedAfter<=value.from&&value.from<=date&&date<=value.to&&value.to<e.date);
}
module.exports={proof,covers};
