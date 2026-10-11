const axios=require('axios');
const {catalogueSymbols,currentSymbol}=require('./brokerSync/trading212Instruments');
const number=v=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
async function resolve(client,userId,account,d){
 const asOf=new Date().toISOString();
 if(d.instrument==='option')return {quantityStep:1,minimumQuantity:1,source:'Whole option contracts',asOf,coverage:'Contract units only; broker buying-power limits unverified'};
 if(account.broker==='trading212'&&d.instrument==='stock'){
  const row=(await client.query("SELECT instruments,fetched_at FROM broker_instrument_catalogues WHERE user_id=$1 AND broker_type='trading212' AND account_identifier=$2",[userId,account.account_identifier])).rows[0];
  const items=row?.instruments||[],aliases=catalogueSymbols(items,d.symbol);
  const match=items.filter(i=>currentSymbol(i)===d.symbol&&aliases.includes(require('./brokerSync/trading212Instruments').normalizeTicker(i.ticker)));
  if(match.length!==1)return {source:'Trading 212 instrument rules unavailable',coverage:'Unverified'};
  const snapshots=(await client.query("SELECT positions FROM broker_portfolio_snapshots WHERE user_id=$1 AND broker_type='trading212' AND account_identifier=$2",[userId,account.account_identifier])).rows;
  const holdings=snapshots.flatMap(r=>r.positions||[]).filter(p=>p.instrument?.ticker===match[0].ticker);
  return {maximumPositionQuantity:number(match[0].maxOpenQuantity),currentQuantity:snapshots.length?holdings.reduce((s,p)=>s+Number(p.quantity||0),0):null,source:'Trading 212 instrument catalogue',asOf:row.fetched_at,coverage:match[0].maxOpenQuantity==null?'Holding limit unavailable in saved metadata; refresh the broker catalogue. Minimum size and increment unverified.':'Maximum holding only; minimum trade size and increment unverified'};
 }
 if(d.instrument==='crypto'&&['okx','kraken'].includes(account.broker)&&d.pair){
  let item,base,quote;
  if(account.broker==='okx'){
   const r=await axios.get('https://www.okx.com/api/v5/public/instruments',{params:{instType:'SPOT',instId:d.pair},timeout:10000,maxRedirects:0});
   item=r.data?.code==='0'&&r.data.data?.find(i=>i.instId===d.pair&&i.state==='live');base=item?.baseCcy;quote=item?.quoteCcy;
  }else{
   const r=await axios.get('https://api.kraken.com/0/public/AssetPairs',{params:{pair:d.pair},timeout:10000,maxRedirects:0});
   const entries=Object.entries(r.data?.error?.length?{}:r.data.result||{});
   item=entries.length===1?entries[0][1]:null;base=item?.wsname?.split('/')[0];quote=item?.wsname?.split('/')[1];
  }
  if(!item||String(base).replace(/^XBT$/,'BTC')!==d.symbol)return {coverage:'Unverified: pair does not identify this asset',source:account.broker};
  const step=account.broker==='okx'?number(item.lotSz):Number.isInteger(item.lot_decimals)?10**-item.lot_decimals:null;
  return {quantityStep:step>0?step:null,minimumQuantity:number(account.broker==='okx'?item.minSz:item.ordermin),minimumValue:quote===d.currency?number(item.costmin):null,pair:d.pair,source:account.broker+' public instrument rules',asOf,coverage:quote===d.currency?'Supplied spot size rules; account restrictions unverified':'Quantity rules only; quote-currency minimum value unverified'};
 }
 return {source:account.broker||'Broker',coverage:'Unverified: broker/product rules must be supplied manually'};
}
module.exports={resolve};
