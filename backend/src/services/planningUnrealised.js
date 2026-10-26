const {priceCacheKey,usablePriceRow}=require('../utils/priceCacheIdentity');
const {latestPlanningFx}=require('./planningFx');
const unavailable=reason=>({status:'unavailable',accounts:[],reason,asOf:null});
async function load(c,plan,result){
 if(result.matchingUnresolved)return unavailable('Match entry rows under Exits to value the remaining units');
 if(result.unresolved||result.overExit||result.costsUnresolved)return unavailable('Reconcile linked fills and costs first');
 if(!(result.openQuantity>1e-8))return {status:'closed',accounts:[],amount:0,currency:'USD',asOf:null};
 if(result.provisionalCount||!Array.isArray(result.openLots)||!result.openLots.length)return unavailable('Link and reconcile the open entry fills first');
 const lots=result.openLots,fx=await latestPlanningFx().catch(()=>null),rates={USD:1,...fx?.rates};
 const cross=(from,to)=>from===to?1:rates[from]>0&&rates[to]>0?rates[to]/rates[from]:null;
 const ids=[...new Set(lots.map(l=>l.accountId).filter(Boolean))];
 const accounts=(await c.query('SELECT id,account_identifier FROM user_accounts WHERE user_id=$1 AND id=ANY($2::uuid[])',[plan.user_id,ids])).rows;
 const accountMap=new Map(accounts.map(a=>[a.id,a.account_identifier]));
 const keys=[...new Set(lots.filter(l=>['stock','crypto'].includes(l.instrument)).map(l=>priceCacheKey(plan.definition.symbol,l.instrument)))];
 const prices=keys.length?(await c.query('SELECT symbol,current_price,last_updated,data_source FROM price_monitoring WHERE symbol=ANY($1)',[keys])).rows:[];
 const needsBroker=lots.some(l=>l.instrument==='cfd');
 const snapshots=needsBroker?(await c.query('SELECT account_identifier,positions,synced_at FROM broker_portfolio_snapshots WHERE user_id=$1 AND account_identifier=ANY($2)',[plan.user_id,[...accountMap.values()]])).rows:[];
 const detailed=needsBroker?await require('./brokerPositionValuations').readDetailed(plan.user_id,[...accountMap.values()]).catch(()=>[]):[];
 const groups=new Map(),sources=new Set();let asOf=null;
 for(const lot of lots){
  if(!accountMap.has(lot.accountId)||lot.accountPrice==null||lot.accountFeePerUnit==null||!lot.accountCurrency)return unavailable('Entry account cost or broker FX is unavailable');
  let value,date,source;
  if(['stock','crypto'].includes(lot.instrument)){
   const quote=prices.find(p=>p.symbol===priceCacheKey(plan.definition.symbol,lot.instrument));
   if(!usablePriceRow(quote,lot.instrument)||!(Number(quote.current_price)>0))return unavailable('Current saved market quote is unavailable');
   value=Number(quote.current_price)*lot.q*lot.multiplier;date=quote.last_updated;source=quote.data_source||'saved market quote';
  }else if(lot.instrument==='cfd'){
   // Invested equity is not an underlying market quote. Match exact broker position identity.
   const live=detailed.filter(p=>p.accountIdentifier===accountMap.get(lot.accountId)&&p.positionId===lot.brokerPositionId&&p.symbol===plan.definition.symbol&&p.instrumentType==='cfd');
   const matches=live.length?live.map(p=>({p:{...p,totalCost:p.capital},date:p.asOf,source:p.source})):snapshots.filter(s=>s.account_identifier===accountMap.get(lot.accountId)).flatMap(s=>(s.positions||[]).filter(p=>lot.brokerPositionId&&String(p.positionId)===lot.brokerPositionId&&Number(p.lotCount||1)===1&&p.symbol===plan.definition.symbol&&p.instrumentType==='cfd').map(p=>({p,date:s.synced_at,source:'saved broker position'})));
   if(matches.length!==1)return unavailable('A valuation for this exact broker position is unavailable');
   const {p}=matches[0],equity=p.value??p.currentValue;
   if(p.currency!=='USD'||!(Number(p.quantity)>0)||equity==null||!Number.isFinite(Number(equity))||lot.q>Number(p.quantity)+1e-8||Math.abs(Number(p.totalCost)/Number(p.quantity)-lot.price*lot.multiplier)>.00001)return unavailable('Broker position quantity or cost needs reconciliation');
   value=Number(equity)*lot.q/Number(p.quantity);date=matches[0].date;source=matches[0].source;
  }else return unavailable('Verified valuation for this instrument is unavailable');
  const time=new Date(date).getTime(),conversion=cross('USD',lot.accountCurrency);
  if(!Number.isFinite(time)||time>Date.now()+60000||!conversion)return unavailable('Valuation date or display FX is unavailable');
  const cost=lot.q*lot.accountPrice,mark=value*conversion,fees=lot.q*lot.accountFeePerUnit;
  const amount=(lot.instrument==='cfd'||lot.side!=='short'?mark-cost:cost-mark)-fees;
  const id=lot.accountId+'|'+lot.accountCurrency,group=groups.get(id)||{accountId:lot.accountId,currency:lot.accountCurrency,amount:0,costBasis:0};group.amount+=amount;group.costBasis+=cost+fees;groups.set(id,group);
  if(!asOf||time<Date.parse(asOf))asOf=new Date(time).toISOString();sources.add(source);
 }
 return {status:'available',accounts:[...groups.values()],asOf,sources:[...sources],fx};
}
module.exports={load};
