const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const prefix='Estimated using previous manual-import balance: ';
const complete=r=>r&&[r.holdings_usd,r.cash_usd,r.stablecoins_usd].every(v=>v!=null&&Number.isFinite(Number(v)))&&Number(r.gbp_per_usd)>0;

// A read-time overlay: later statements/rebuilt daily values replace estimates
// automatically. Never persist carried amounts as observed broker values.
function carryForward(rows,accounts,rates,endDate) {
  const eligible=accounts.filter(a=>['ig','etoro'].includes(a.broker));
  const index=new Map(rows.map(r=>[`${r.account_identifier}:${day(r.value_date)}`,r]));
  const result=[...rows],datedRates=[...rates].sort(([a],[b])=>a.localeCompare(b));
  for(const account of eligible) {
    const own=rows.filter(r=>r.account_identifier===account.account_identifier).sort((a,b)=>day(a.value_date).localeCompare(day(b.value_date)));
    if(!own.length)continue;
    let seed=null;
    const end=endDate||day(own.at(-1).value_date);
    for(let timestamp=Date.parse(day(own[0].value_date)+'T00:00:00Z');timestamp<=Date.parse(end+'T00:00:00Z');timestamp+=86400000) {
      const date=day(new Date(timestamp)),key=`${account.account_identifier}:${date}`,row=index.get(key);
      if(complete(row)){seed=row;continue;}
      if(!seed)continue;
      const prior=datedRates.filter(([d])=>d<=date&&Date.parse(date)-Date.parse(d)<=7*86400000).at(-1)?.[1];
      const fx=rates.get(date)||Number(row?.gbp_per_usd)||prior;
      if(!(fx>0))continue;
      // IG is GBP; eToro is USD. Keep the native balance fixed, not its
      // converted value. Dated FX can still move the displayed total.
      const factor=account.currency==='GBP'?Number(seed.gbp_per_usd)/fx:1;
      const estimate={...row,account_identifier:account.account_identifier,value_date:date,
        holdings_usd:Number(seed.holdings_usd)*factor,cash_usd:Number(seed.cash_usd)*factor,
        stablecoins_usd:Number(seed.stablecoins_usd)*factor,gbp_per_usd:fx,stale_prices:0,
        source:'reconstructed',carryForwardFrom:day(seed.value_date),
        issues:[prefix+day(seed.value_date)+'; awaiting statement backfill']};
      if(row)result[result.indexOf(row)]=estimate;else result.push(estimate);
    }
  }
  return result.sort((a,b)=>day(a.value_date).localeCompare(day(b.value_date)));
}
module.exports={carryForward,prefix};
