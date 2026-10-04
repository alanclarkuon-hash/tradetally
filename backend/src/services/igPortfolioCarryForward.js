const prefix='Estimated using previous IG balance: ';
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
// The owner confirmed that absent daily statements mean no open positions.
// Preserve actual observations and keep carried values distinct from statements.
function carryForward(rows,accounts,rates) {
  const eligible=new Set(accounts.filter(a=>a.is_ig_spread).map(a=>a.account_identifier));
  const previous=new Map();
  const datedRates=[...rates].sort(([a],[b])=>a.localeCompare(b));
  return [...rows].sort((a,b)=>day(a.value_date).localeCompare(day(b.value_date))).map(row=>{
    if(!eligible.has(row.account_identifier))return row;
    const complete=r=>r&&[r.holdings_usd,r.cash_usd,r.stablecoins_usd].every(v=>v!=null&&Number.isFinite(Number(v)))&&Number(r.gbp_per_usd)>0;
    if(complete(row)){previous.set(row.account_identifier,row);return row;}
    const date=day(row.value_date),seed=previous.get(row.account_identifier);
    const priorRate=datedRates.filter(([d])=>d<=date&&Date.parse(date)-Date.parse(d)<=7*86400000).at(-1)?.[1];
    const fx=rates.get(date)||Number(row.gbp_per_usd)||priorRate;
    if(!complete(seed)||!(fx>0))return row;
    const factor=Number(seed.gbp_per_usd)/fx;
    return {...row,holdings_usd:Number(seed.holdings_usd)*factor,cash_usd:Number(seed.cash_usd)*factor,
      stablecoins_usd:Number(seed.stablecoins_usd)*factor,gbp_per_usd:fx,source:'reconstructed',
      issues:[prefix+day(seed.value_date)+'; no statement or open position reported by account owner']};
  });
}
module.exports={carryForward,prefix};
