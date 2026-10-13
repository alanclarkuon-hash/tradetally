// A broker product key is not a listed-security ticker. An explicitly recorded
// underlying may be warmed for analysis, but never values its derivative.
const {historicalMarketSymbol}=require('./portfolioCorporateActions');
const derivativeTypes=new Set(['option','future','spread_bet']);
const etoroProducts=new Map(require('./calendars/etoro-contract-products.json').products.map(p=>[p.symbol.toUpperCase(),p]));
function identity(row,date) {
 const type=row.instrument_type||row.instrumentType||'stock';
 const product=row.broker==='etoro'&&['stock','cfd'].includes(type)?etoroProducts.get(String(row.symbol).toUpperCase()):null;
 if(product)return {symbol:row.symbol,instrumentType:'cfd',unsupported:true,brokerProduct:product.kind,reason:'Historical '+product.kind+' broker contract prices are not verified as listed-security closes. Broker statement valuations are retained.'};
 if(derivativeTypes.has(type)) {
  const underlying=row.underlying_symbol;
  if(!underlying || type==='spread_bet' && underlying===row.symbol) return {symbol:row.symbol,instrumentType:type,unsupported:true,
   reason:'Historical contract prices unavailable: no verified underlying ticker is recorded. Broker statement valuations are retained.'};
  return {symbol:historicalMarketSymbol(underlying,'stock',date),instrumentType:'stock',analysisOnly:true};
 }
 if(type==='cfd'&&(['OIL','GOLD','SILVER','COPPER','NGAS','NATGAS','PLATINUM','PALLADIUM'].includes(row.symbol)||row.symbol?.endsWith('.FUT')))
  return {symbol:row.symbol,instrumentType:type,unsupported:true,reason:'Broker commodity/futures contract has no verified listed-security price history. Broker statement valuations are retained.'};
 const kind=type==='crypto'?'crypto':'stock';
 const symbol=historicalMarketSymbol(row.history_market_symbol||row.symbol,kind,date);
 return {symbol:kind==='crypto'?symbol.replace(/-USD$/,''):symbol,instrumentType:kind};
}
async function unsupportedSymbols(client,userId=null) {
 const rows=(await client.query('SELECT symbol,instrument_type,underlying_symbol,broker FROM trades WHERE ($1::uuid IS NULL OR user_id=$1)',[userId]))?.rows||[];
 const result=new Map(),stockSymbols=new Set(rows.filter(r=>(r.instrument_type||'stock')==='stock'&&!identity(r).unsupported).map(r=>r.symbol));
 for(const row of rows){const mapped=identity(row);if(stockSymbols.has(row.symbol))continue;
  if(mapped.unsupported)result.set(row.symbol,mapped);
  else if(mapped.analysisOnly && mapped.symbol!==row.symbol)result.set(row.symbol,{symbol:row.symbol,instrumentType:row.instrument_type,unsupported:true,reason:'Broker contract prices are unavailable. Recorded underlying history is for analysis only and cannot value this contract.'});
 }
 return result;
}
async function classifySavedTasks(client,userId,state) {
 const unsupported=await unsupportedSymbols(client,userId);
 for(let i=0;i<state.tasks.length;i++) {
  const task=state.tasks[i],known=task.instrumentType!=='crypto'?unsupported.get(task.symbol):null;
  if(!known||task.unsupported)continue;
  if(i<state.processed&&!state.gaps.some(g=>g.symbol===task.symbol&&g.instrumentType===task.instrumentType))state.complete=Math.max(0,state.complete-1);
  Object.assign(task,known);
  if(i<state.processed&&!state.gaps.some(g=>g.symbol===task.symbol))state.gaps.push({...task,ranges:[]});
 }
 state.gaps=state.gaps.map(g=>g.instrumentType!=='crypto'&&unsupported.has(g.symbol)?{...g,...unsupported.get(g.symbol),ranges:[]}:g);
}
module.exports={identity,unsupportedSymbols,classifySavedTasks};
