// Dated USD -> display rates for period opening/acquisition values.
// Missing historical FX is not replaced with today's rate.
function datedDisplayRate(rows,currency) {
  const rates=rows.map(r=>({date:new Date(r.rate_date).toISOString().slice(0,10),rates:r.rates})).sort((a,b)=>a.date.localeCompare(b.date));
  const memo=new Map();
  return date=>{
    if(currency==='USD')return 1;
    if(memo.has(date))return memo.get(date);
    let low=0,high=rates.length;
    while(low<high){const middle=(low+high)>>>1;if(rates[middle].date<=date)low=middle+1;else high=middle;}
    const row=rates[low-1],rate=Number(row?.rates?.[currency]);
    const result=row&&Date.parse(date)-Date.parse(row.date)<=7*86400000&&rate>0?rate:null;
    memo.set(date,result);return result;
  };
}
function displayBasis(parts,rateAt) {
  let total=0;
  for(const p of parts){const rate=rateAt(p.date);if(!(rate>0)||!Number.isFinite(p.amount))return null;total+=p.amount*rate;}
  return total;
}
module.exports={datedDisplayRate,displayBasis};
