const {read} = require('../brokerMarketData');
const {assetCode,category,decimal} = require('./krakenReconcile');
const {dailyPrices} = require('./krakenArchivePrices');
const ORIGIN='https://api.kraken.com';
const day=time=>new Date(Number(time)*1000).toISOString().slice(0,10);
async function publicRead(path,params={}) {
  if(!['AssetPairs','OHLC','Ticker'].includes(path))throw Error('Unsupported Kraken public price endpoint');
  let response;
  try {response={data:await read('kraken',`${ORIGIN}/0/public/${path}`,params)};}
  catch {throw Error('Kraken public price data is unavailable; previous reports were preserved');}
  if(!Array.isArray(response.data?.error)||response.data.error.length||!response.data.result)
    throw Error('Kraken public price response is incomplete');
  return response.data.result;
}
function selectPairs(metadata,symbols) {
  const result={};
  for(const symbol of symbols) {
    if(symbol==='USD')continue;
    // Kraken's 1:1 migration makes POL an explicitly labelled valuation proxy
    // for legacy MATIC rewards when the retired market has no candle coverage.
    const base=symbol==='MATIC'?'POL':symbol;
    const pair=Object.entries(metadata).find(([,p])=>assetCode(p.base)===base&&assetCode(p.quote)==='USD'&&
      (!p.aclass_base||p.aclass_base==='currency'));
    if(pair)result[symbol]={id:pair[0],base,proxy:symbol==='MATIC'};
  }
  return result;
}
function requiredDates(payload) {
  const required=new Map();
  const add=(symbol,date)=>{if(!required.has(symbol))required.set(symbol,new Set());required.get(symbol).add(date);};
  for(const l of Object.values(payload.ledger)) {
    const symbol=assetCode(l.asset),kind=category(l);
    if(symbol==='GBP'||symbol==='USDT'||symbol==='USDG'||kind==='staking_reward'||kind==='margin_settlement'||kind==='external_crypto_transfer')
      add(symbol,day(l.time));
  }
  for(const [asset,value] of Object.entries(payload.balances))if(decimal(value.balance)>0n)add(assetCode(asset),payload.asOf.slice(0,10));
  return required;
}
async function collect(payload) {
  const required=requiredDates(payload),pairs=selectPairs(await publicRead('AssetPairs'),required.keys());
  const now=new Date().toISOString(),today=now.slice(0,10),rates={...(payload.valuation?.rates||{})},sources={},gaps=[];
  const unique=[...new Set(Object.values(pairs).map(p=>p.id))];
  const ticker=unique.length?await publicRead('Ticker',{pair:unique.join(',')}):{};
  const current={USD:{price:1,asOf:now,source:'USD reporting currency'}};
  for(const [symbol,pair] of Object.entries(pairs)) {
    const price=Number(ticker[pair.id]?.c?.[0]);
    if(!(price>0))throw Error(`Missing Kraken current price: ${symbol}`);
    current[symbol]={price,asOf:now,source:`Kraken ${pair.id} last trade`,proxy:pair.proxy};
  }
  const series=new Map();
  for(const [symbol,dates] of required) {
    rates[symbol]={...(rates[symbol]||{})};
    if(symbol==='USD'){for(const date of dates)rates[symbol][date]=1;continue;}
    const pair=pairs[symbol];
    if(!pair){for(const date of dates)gaps.push({symbol,date,reason:'No USD market'});continue;}
    if(!series.has(pair.id)) {
      const result=await publicRead('OHLC',{pair:pair.id,interval:1440,since:0});
      const candles=result[pair.id];if(!Array.isArray(candles))throw Error('Missing Kraken daily candle series');
      const history={};
      for(const candle of candles) {
        const date=day(candle[0]),price=Number(candle[4]);
        if(!(price>0))throw Error('Invalid Kraken daily price');
        if(date<today)history[date]=price; // Never use an unfinished daily close.
      }
      series.set(pair.id,history);
      await new Promise(resolve=>setTimeout(resolve,1100));
    }
    let history=series.get(pair.id);
    sources[symbol]=pair.proxy?'Kraken POL/USD daily UTC close; estimated legacy MATIC value using documented 1:1 migration':'Kraken daily UTC close';
    // Only try the bounded official archive for an unsupported legacy MATIC
    // date. Retain real MATIC closes where available instead of using a proxy.
    if(symbol==='MATIC') {
      const archive=await dailyPrices('MATICUSD');
      history={...history,...archive.prices};
    }
    rates[symbol]={...rates[symbol],...history};
    for(const date of dates) {
      const price=date===today?current[symbol]?.price:history[date]||rates[symbol][date];
      if(!(price>0))gaps.push({symbol,date,reason:'Historical candle unavailable'});
      else rates[symbol][date]=price;
    }
  }
  return {asOf:now,current,rates,sources,gaps,complete:gaps.length===0,
    estimatedSymbols:required.has('MATIC')?['MATIC']:[],method:'Daily UTC closing values; today uses timestamped last-trade prices'};
}
module.exports={collect,requiredDates,selectPairs};
