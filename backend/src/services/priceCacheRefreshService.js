const db=require('../config/database');
const {priceCacheKey}=require('../utils/priceCacheIdentity');
const day=value=>new Date(value).toISOString().slice(0,10);
const TYPE='historical_price_backfill';
const kind=(symbol,source)=>/^crypto:/i.test(symbol)||['coingecko','okx','kraken'].includes(source)||/:crypto$/.test(source)?'crypto':'stock';
async function enqueue(userId) {
 const existing=(await db.query("SELECT id FROM job_queue WHERE user_id=$1 AND type=$2 AND data->>'mode'='broker_refresh' AND status IN ('pending','processing') LIMIT 1",[userId,TYPE])).rows[0];
 if(existing)return existing.id;
 const row=(await db.query("INSERT INTO job_queue(type,user_id,data,status,priority) VALUES($1,$2,$3,'pending',3) RETURNING id",[TYPE,userId,JSON.stringify({mode:'broker_refresh'})])).rows[0];
 require('../utils/jobQueue').notifyJobEnqueued([TYPE]);return row.id;
}
async function plan() {
 const tasks=new Map();
 const rows=(await db.query('SELECT symbol,data_source,MIN(price_date) AS first,MAX(price_date) AS last FROM historical_prices GROUP BY symbol,data_source')).rows;
 const quotes=(await db.query('SELECT symbol,data_source FROM price_monitoring')).rows;
 const reconstructed=(await db.query("SELECT symbol,payload->'prices'->0->>'date' AS first,payload->'prices'->-1->>'date' AS last FROM portfolio_reconstruction_prices WHERE jsonb_array_length(COALESCE(payload->'prices','[]'::jsonb))>0")).rows;
 const yesterday=day(Date.now()-86400000);
 for(const row of [...rows,...quotes,...reconstructed.map(r=>r.symbol.endsWith('-USD')?{...r,symbol:'crypto:'+r.symbol.slice(0,-4)}:r)]) {
  const instrumentType=kind(row.symbol,row.data_source),symbol=row.symbol.replace(/^crypto:/i,''),key=priceCacheKey(symbol,instrumentType);
  const old=tasks.get(key)||{symbol,instrumentType,key,quote:false};
  if(row.first){const from=day(row.first),to=day(row.last)>yesterday?yesterday:day(row.last);if(from<=to){old.from=!old.from||from<old.from?from:old.from;old.to=!old.to||to>old.to?to:old.to;}}
  else old.quote=true;
  tasks.set(key,old);
 }
 return [...tasks.values()].sort((a,b)=>Number(b.quote)-Number(a.quote)||a.symbol.localeCompare(b.symbol));
}
async function refreshHistory(userId,task) {
 if(!task.from)return {brokerRows:0};
 const {missingRanges}=require('./holdingsHistoryProvider'),cache=require('../utils/historicalPriceCache');
 const calendar=task.instrumentType==='crypto'?null:await require('./exchangeCalendar').resolve(task.symbol,{allowLookup:true});
 const old=(await db.query(`SELECT price_date,close FROM historical_prices WHERE symbol=$1 AND price_currency='USD' AND is_final
   AND (data_source LIKE 'broker:%' OR data_source IN ('kraken','okx')) AND price_date BETWEEN $2 AND $3`,[task.key,task.from,task.to])).rows;
 const brokerPrices=new Map(old.map(r=>[Date.parse(r.price_date)/1000,{time:Date.parse(r.price_date)/1000,close:Number(r.close)}]));
 let brokerRows=0;
 await require('./brokerHistoryProviders').fetch({userId,symbol:task.symbol,instrumentType:task.instrumentType,
  ranges:()=>missingRanges([...brokerPrices.values()],task.from,task.to,task.instrumentType==='crypto',calendar),
  onPrices:async(candles,broker)=>{
   const prices=await require('../utils/dailyPriceCurrency').toUsd(candles,task.instrumentType==='crypto'||calendar==='US'?'USD':null);
   await cache.insertCandles(task.key,prices,'broker:'+broker,{currency:'USD',replaceFinal:true});
   await updateReconstruction(task,prices);
   for(const p of prices)brokerPrices.set(p.time,p);brokerRows+=prices.length;
  }});
 // Normalize reusable dated reconstruction evidence, then fill only genuine
 // remaining gaps through the normal shared broker/provider fallback chain.
 const prices=await require('./portfolioService')._getDailySeries(task.symbol,task.from,task.to,userId,{instrumentType:task.instrumentType});
 const gaps=missingRanges(prices,task.from,task.to,task.instrumentType==='crypto',calendar);
 return {brokerRows,gaps,calendar};
}
async function updateReconstruction(task,prices) {
 if(!prices.length)return;
 const key=task.instrumentType==='crypto'?task.symbol+'-USD':task.symbol;
 const old=(await db.query('SELECT payload FROM portfolio_reconstruction_prices WHERE symbol=$1',[key])).rows[0]?.payload;
 if(!old?.currency)return; // Split/identity metadata must not be invented.
 const merged=new Map((old.prices||[]).map(p=>[p.date,p]));
 for(const c of prices){const date=day(c.time*1000),fx=old.currency==='USD'?1:await require('../utils/currencyConverter').getForexRate('USD',old.currency,date);
  const split=task.instrumentType==='crypto'?1:(old.splits||[]).filter(s=>s.date>date).reduce((n,s)=>n*s.ratio,1);
  if(fx>0&&split>0)merged.set(date,{date,close:c.close*fx*split});}
 const payload={...old,prices:[...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)),source:'Shared verified broker/provider history'};
 await db.query('UPDATE portfolio_reconstruction_prices SET payload=$2,fetched_at=NOW() WHERE symbol=$1',[key,payload]);
}
async function process(job,progress) {
 let state=typeof job.result==='string'?JSON.parse(job.result):job.result;
 state=state?.tasks?state:{tasks:await plan(),processed:0,complete:0,gaps:[],stage:'broker_refresh',brokerRows:0,quotesRefreshed:0,mode:'broker_refresh'};
 state.total=state.tasks.length;
 const timer=setInterval(()=>progress(job.id,state).catch(()=>{}),30000);timer.unref?.();
 try {
  state.stage='quotes';
  const quoteTasks=state.tasks.filter(t=>t.quote);
  state.quoteTotal=quoteTasks.length;
  for(let i=state.quoteProcessed||0;i<quoteTasks.length;i++) {
   const task=quoteTasks[i];state.currentSymbol=task.symbol;await progress(job.id,state);
   try{const quote=await require('./currentQuoteService').getQuote(task.symbol,task.instrumentType);
    if(await require('./marketQuoteCache').save(task.symbol,task.instrumentType,quote))state.quotesRefreshed++;}
   catch{state.quoteFailures=(state.quoteFailures||0)+1;}
   state.quoteProcessed=i+1;await progress(job.id,state);
  }
  state.stage='broker_refresh';
  for(let i=state.processed;i<state.tasks.length;i++) {
   const task=state.tasks[i];state.currentSymbol=task.symbol;await progress(job.id,state);
   try {
    const result=await refreshHistory(job.user_id,task);state.brokerRows+=result.brokerRows;
    if(result.gaps?.length)state.gaps.push({...task,calendar:result.calendar,ranges:result.gaps,reason:'No finalized broker/provider prices for expected sessions'});
    else state.complete++;
   }catch{state.gaps.push({...task,ranges:task.from?[{from:task.from,to:task.to}]:[],reason:'Price refresh unavailable; existing verified prices retained'});}
   state.processed=i+1;await progress(job.id,state);
  }
  state.stage='portfolio';state.currentSymbol=null;await progress(job.id,state);
  const maintenance=await require('./brokerPortfolioMaintenance').maintain(job.user_id,{fetchPrices:false,fullHistory:true});
  await require('./analyticsCache').invalidate(job.user_id);
  state.portfolioWarnings=[...(maintenance.warnings||[]),...(state.quoteFailures?[`${state.quoteFailures} saved quote identities could not be refreshed; existing quotes were retained.`]:[])];
  state.stage='finished';state.currentSymbol=null;await progress(job.id,state);return state;
 }finally{clearInterval(timer);}
}
module.exports={enqueue,plan,process,refreshHistory};
