const {fresh}=require('./planningBrokerEvidence');
const field=(o,k)=>o?.[Object.keys(o||{}).find(x=>x.toLowerCase()===k.toLowerCase())];
const num=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):null;
function parse(broker,payload,asOf){
 const recent=fresh(payload.asOf||asOf,15),cash=[],stops=[];let note='Manual broker verification required: live buying power, borrowing and working stops are not supplied by this integration';
 const add=(currency,amount)=>{if(recent&&amount!=null&&amount>=0&&/^[A-Z]{3,8}$/.test(currency))cash.push({currency,amount,asOf:payload.asOf||asOf,source:broker+' broker available funds'})};
 if(broker==='trading212'){
  note='Account cash uses a separate fresh broker snapshot; live working stops and borrowing are not supplied by this integration';
 }else if(broker==='etoro'){
  const portfolio=payload.portfolio,keys=['orders','entryOrders','stockOrders','ordersForOpen'];
  const noOrders=keys.every(k=>Array.isArray(field(portfolio,k))&&field(portfolio,k).length===0)&&Array.isArray(field(portfolio,'mirrors'))&&field(portfolio,'mirrors').length===0;
  if(noOrders)add('USD',num(field(portfolio,'credit')));
  note=noOrders?'USD cash verified only while snapshot is fresh':'Pending-order or copied-portfolio reservations need manual verification';
  for(const p of payload.positions||[]){const instrument=(payload.instruments||[]).find(i=>String(field(i,'instrumentId'))===String(field(p,'instrumentId'))),id=field(p,'positionId'),q=num(field(p,'units')),price=num(field(p,'stopLossRate')),fx=num(field(field(p,'unrealizedPnL'),'closeConversionRate'));
   // A position-attached fixed stop covers this position only. Trailing stops require a separate current trigger.
   if(recent&&id!=null&&q>0&&price>0&&fx>0&&field(p,'isNoStopLoss')===false&&field(p,'isTslEnabled')===false&&field(p,'isBuy')===true&&num(field(p,'leverage'))===1&&field(instrument,'symbolFull'))stops.push({positionId:String(id),symbol:String(field(instrument,'symbolFull')).toUpperCase(),quantity:q,price:price*fx,currency:'USD',source:'eToro position-attached fixed stop',asOf:payload.asOf||asOf});
  }
 }else if(broker==='kraken'){
  const aliases={ZGBP:'GBP',ZUSD:'USD',ZEUR:'EUR',ZCAD:'CAD',ZJPY:'JPY',ZAUD:'AUD',ZCHF:'CHF',XXBT:'BTC',XBT:'BTC',XETH:'ETH'};
  for(const [code,b] of Object.entries(payload.balances||{})){const balance=num(b.balance),held=num(b.hold_trade),used=num(b.credit_used),credit=num(b.credit);if(balance!=null&&held!=null&&used!=null&&credit===0)add(aliases[code]||code,Math.max(0,balance-held-used))}
  note='Native spot balances after order holds; credit and margin borrowing are not assumed';
 }else if(broker==='okx'){
  if(Array.isArray(payload.positions)&&payload.positions.length===0&&payload.trading?.length===1)for(const b of payload.trading[0].details||[]){const available=num(b.availBal),own=num(b.cashBal),liability=num(b.liab);if(available!=null&&own!=null&&(liability===0||b.liab===''))add(b.ccy,Math.min(available,Math.max(0,own)))}
  note='Trading wallet native spot cash only; funding wallet and borrowing excluded';
 }
 return {broker,recent,asOf:payload.asOf||asOf,cash,stops,note,borrowingVerified:false};
}
async function load(client,userId,accounts){
 const rows=(await client.query('SELECT broker_type,account_identifier,payload,captured_at FROM broker_import_snapshots WHERE user_id=$1',[userId])).rows;
 return accounts.map(a=>{const own=rows.filter(r=>r.broker_type===a.broker&&r.account_identifier===a.account_identifier);return {accountId:a.id,...parse(a.broker,own.length===1?own[0].payload:{},own.length===1?own[0].captured_at:null)}});
}
function stopRisk(position,coverage){
 const trades=position.trades.flatMap(t=>t._brokerRelatedTrades||[t]);const ids=[...new Set(trades.flatMap(t=>(t.executions||[]).map(e=>e.etoro_position_id).filter(Boolean)))];
 const stops=coverage?.stops?.filter(s=>s.symbol===position.symbol&&ids.includes(s.positionId))||[];
 const quantity=stops.reduce((v,s)=>v+s.quantity,0);
 if(position.side!=='long'||position.currency!=='USD'||!ids.length||stops.length!==ids.length||Math.abs(quantity-position.totalQuantity)>1e-8)return null;
 // Cost must be matched to each broker position; using the combined average can hide uncovered lots.
 let risk=0;for(const s of stops){const own=trades.filter(t=>require('../utils/openPositionGrouping').storedCurrency(t)==='USD'&&(t.executions||[]).some(e=>e.etoro_position_id===s.positionId));if(own.length!==1||!(Number(own[0].entry_price)>=0))return null;risk+=s.quantity*Math.max(0,Number(own[0].entry_price)-s.price)}
 return {risk,coveredQuantity:quantity,source:'Broker position-attached fixed stops (FX estimate)',asOf:coverage.asOf,brokerConfirmed:true};
}
module.exports={parse,load,stopRisk};
