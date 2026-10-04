const {extract}=require('./brokerSync/transferMatches');
const day=time=>new Date(time).toISOString().slice(0,10);

// External principal only: fees remain part of portfolio performance. Native
// wallet/Earn movements are not external funding. Matched legs inside the
// selection disappear even when they arrive on different calendar dates.
function cryptoFundingEvents(snapshots,accounts,pairs,prices,fx,currency,range) {
  const selected=new Map(accounts.map(a=>[a.account_identifier,a]));
  const events=[];
  for(const leg of extract(snapshots)) {
    const account=selected.get(leg.account);
    if(!account)continue;
    const date=day(leg.time);
    if(range&&(date<range.start_date||date>range.end_date))continue;
    const side=leg.direction==='out'?'source':'destination';
    const match=pairs.find(p=>p[side+'_account']===leg.account&&p[side+'_broker']===leg.broker&&p[side+'_reference']===leg.reference&&p.asset===leg.asset);
    if(match&&selected.has(match.source_account)&&selected.has(match.destination_account))continue;
    const snapshot=snapshots.find(s=>s.broker_type===leg.broker&&s.account_identifier===leg.account);
    const own=snapshot?.payload;
    // A matched boundary leg uses the amount actually delivered. Otherwise
    // Kraken deposit quantities exclude fees; restore principal for funding.
    const quantity=match?Number(match.quantity):Number(leg.quantity)+(leg.direction==='in'?Number(leg.fee):0);
    let price=Number(own?.valuation?.rates?.[leg.asset]?.[date]);
    if(!(price>0))for(const s of snapshots){price=Number(s.payload?.valuation?.rates?.[leg.asset]?.[date]);if(price>0)break;}
    if(!(price>0)&&leg.asset==='USDT')price=Number(own?.rates?.[date]);
    const series=prices.get(leg.asset+'-USD');
    if(!(price>0)&&series?.currency==='USD')price=Number(series.prices?.find(p=>p.date===date)?.close);
    const conversion=fx(date,'USD',currency);
    const signedQuantity=(leg.direction==='in'?1:-1)*quantity;
    events.push({date,type:'transfer',asset:leg.asset,quantity:signedQuantity,crypto:true,
      amount:price>0&&conversion.rate>0?Math.round(signedQuantity*price*conversion.rate*100)/100:null,
      nativeAmount:signedQuantity,nativeCurrency:leg.asset,account:account.account_name,
      fxSourceDate:conversion.sourceDate,valuationSource:price>0?'Saved transfer-date USD price':null});
  }
  return events;
}
module.exports={cryptoFundingEvents};
