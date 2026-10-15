// Dated USD -> display rates for period opening/acquisition values.
// Missing historical FX is not replaced with today's rate.
function datedDisplayRate(rows,currency) {
  const rates=[...rows].sort((a,b)=>new Date(a.rate_date)-new Date(b.rate_date));
  return date=>{
    if(currency==='USD')return 1;
    const row=rates.filter(r=>new Date(r.rate_date).toISOString().slice(0,10)<=date).at(-1);
    const rate=Number(row?.rates?.[currency]);
    return row&&Date.parse(date)-Date.parse(new Date(row.rate_date).toISOString().slice(0,10))<=7*86400000&&rate>0?rate:null;
  };
}
function displayBasis(parts,rateAt) {
  let total=0;
  for(const p of parts){const rate=rateAt(p.date);if(!(rate>0)||!Number.isFinite(p.amount))return null;total+=p.amount*rate;}
  return total;
}
module.exports={datedDisplayRate,displayBasis};
