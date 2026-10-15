const db=require('../config/database');
const BrokerConnection=require('../models/BrokerConnection');
const etoro=require('./brokerSync/etoroService');
const {field,flattenPositions}=etoro;
const crypto=require('crypto');
const LEVERAGED=new Set(['cfd','future','option','forex','spread_bet','perpetual','margin']);
const entries=new Map(),pending=new Map();
let timer=null,scheduling=false;
const key=row=>`${row.user_id}:${row.connection_id}:${row.account_identifier}`;
const signature=row=>crypto.createHash('sha256').update(JSON.stringify([row.positions,new Date(row.synced_at).toISOString()])).digest('hex');
const close=(a,b)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<=Math.max(1e-8,Math.abs(Number(b))*1e-8);
function unavailable(message){const error=Error(message);error.code='VALUATION_UNAVAILABLE';return error;}
function number(value){if(value==null||value===''||!Number.isFinite(Number(value)))throw unavailable('Incomplete broker valuation');return Number(value);}
function sourceTime(p,observed){
 const value=field(field(p,'unrealizedPnL'),'timestamp');
 if(value==null)return {asOf:observed,kind:'observed'};
 const time=Date.parse(value);if(!Number.isFinite(time)||time>Date.now()+60000)throw unavailable('Invalid broker valuation time');
 return {asOf:new Date(time).toISOString(),kind:'valuation'};
}
// https://api-portal.etoro.com/core/guides/calculate-equity.md
// USD position equity is allocated amount + broker unrealizedPnL.pnL.
// Do not reapply leverage, FX, fees, taxes or financing to reported USD P&L.
async function etoroValues(connection,row){
 const identity=await etoro.get(connection,'/me');
 if(String(field(identity,'realCid'))!==String(connection.externalAccountId))throw Error('Broker account identity changed');
 const response=await etoro.get(connection,'/trading/info/real/pnl');
 const observed=new Date().toISOString(),portfolio=field(response,'clientPortfolio'),live=flattenPositions(portfolio);
 const duplicates=new Map();
 for(const p of [...field(portfolio,'positions'),...(field(portfolio,'mirrors')||[]).flatMap(m=>field(m,'positions'))]){
  const id=String(field(p,'positionId')),proof=JSON.stringify(['CID','instrumentId','units','amount','leverage','isBuy','settlementTypeID','unrealizedPnL'].map(k=>field(p,k)));
  if(duplicates.has(id)&&duplicates.get(id)!==proof)throw Error('Conflicting copied valuation');
  duplicates.set(id,proof);
 }
 const raw=row.payload?.positions;
 if(!Array.isArray(raw)||!Array.isArray(row.payload?.instruments))throw Error('Stored position evidence unavailable');
 const instruments=new Map(row.payload.instruments.map(p=>[String(field(p,'instrumentId')),String(field(p,'symbolFull')).toUpperCase()]));
 const values=[];
 for(const position of row.positions.filter(p=>LEVERAGED.has(p.instrumentType))){
  if(position.instrumentType!=='cfd'){values.push({symbol:position.symbol,instrumentType:position.instrumentType,status:'unsupported'});continue;}
  const saved=raw.filter(p=>instruments.get(String(field(p,'instrumentId')))===position.symbol);
  const current=live.filter(p=>instruments.get(String(field(p,'instrumentId')))===position.symbol);
  try{
   if(!saved.length||saved.length!==current.length)throw Error('Position set changed');
   const ids=new Set(saved.map(p=>String(field(p,'positionId'))));
   if(ids.size!==saved.length||current.some(p=>!ids.has(String(field(p,'positionId')))))throw Error('Position set changed');
   let quantity=0,capital=0,value=0;const times=[];
   for(const old of saved){
    const p=current.find(p=>String(field(p,'positionId'))===String(field(old,'positionId')));
    if(String(field(old,'CID'))!==String(connection.externalAccountId)||String(field(p,'CID'))!==String(connection.externalAccountId))throw Error('Position account changed');
    for(const name of ['instrumentId','orderId','openDateTime','isBuy','settlementTypeID','leverage']){
     if(field(old,name)==null||String(field(p,name))!==String(field(old,name)))throw Error('Position identity changed');
    }
    for(const name of ['units','amount','openRate','openConversionRate'])if(!close(field(p,name),field(old,name)))throw Error('Position basis changed');
    const units=number(field(p,'units')),amount=number(field(p,'amount')),pnl=number(field(field(p,'unrealizedPnL'),'pnL'));
    if(!(units>0&&amount>0))throw Error('Invalid position basis');
    quantity+=units;capital+=amount;value+=amount+pnl;times.push(sourceTime(p,observed));
   }
   if(!close(quantity,position.quantity)||Math.abs(capital-number(position.totalCost))>0.05)throw Error('Saved capital or quantity needs sync');
   // Reject an unknown extra live position even if its instrument metadata is new.
   if(live.some(p=>!raw.some(o=>String(field(o,'positionId'))===String(field(p,'positionId')))&&saved.some(o=>String(field(o,'instrumentId'))===String(field(p,'instrumentId')))))throw Error('New position needs sync');
   const time=times.reduce((a,b)=>Date.parse(a.asOf)<=Date.parse(b.asOf)?a:b);
   values.push({symbol:position.symbol,instrumentType:position.instrumentType,quantity,capital,value,asOf:time.asOf,timestampKind:time.kind,status:'current',source:'broker:etoro:position'});
  }catch(error){values.push({symbol:position.symbol,instrumentType:position.instrumentType,status:error.code==='VALUATION_UNAVAILABLE'?'unavailable':'sync_required'});}
 }
 return values;
}
const adapters=new Map([['etoro',etoroValues]]);
async function rows(userId){
 return (await db.query(`SELECT s.*,jsonb_build_object('positions',i.payload->'positions','instruments',i.payload->'instruments') AS payload,c.connection_status FROM broker_portfolio_snapshots s
 LEFT JOIN LATERAL (SELECT payload FROM broker_import_snapshots i WHERE i.user_id=s.user_id AND i.connection_id=s.connection_id AND i.broker_type=s.broker_type ORDER BY i.captured_at DESC LIMIT 1) i ON TRUE
 JOIN broker_connections c ON c.id=s.connection_id AND c.user_id=s.user_id
 WHERE ($1::uuid IS NULL OR s.user_id=$1) AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.positions) p WHERE p->>'instrumentType'=ANY($2))`,[userId||null,[...LEVERAGED]])).rows;
}
function schedule(row){
 const id=key(row),token=signature(row),previous=entries.get(id);
 if(row.connection_status!=='active'||!adapters.has(row.broker_type))return;
 if(pending.has(id)||previous?.token===token&&Date.now()<previous.retryAt)return;
 const state={token,retryAt:Date.now()+30000,values:previous?.token===token?previous.values:[],status:'updating'};entries.set(id,state);
 const work=(async()=>{
  try{
   const connection=await BrokerConnection.findById(row.connection_id,true);
   if(!connection||String(connection.userId)!==String(row.user_id))throw Error('Account unavailable');
   const values=await adapters.get(row.broker_type)(connection,row);
   // A concurrent sync may have changed the imported position set while reading.
   const fresh=(await db.query('SELECT positions,synced_at FROM broker_portfolio_snapshots WHERE user_id=$1 AND connection_id=$2 AND account_identifier=$3',[row.user_id,row.connection_id,row.account_identifier])).rows[0];
   if(!fresh||signature(fresh)!==token){entries.delete(id);return;}
   const old=new Map((state.values||[]).map(v=>[`${v.instrumentType}:${v.symbol}`,v]));
   state.values=values.map(v=>{const prior=old.get(`${v.instrumentType}:${v.symbol}`);
    if(prior?.status==='current'&&v.status!=='current')return {...prior,refreshStatus:v.status};
    return prior&&v.status==='current'&&Date.parse(prior.asOf)>Date.parse(v.asOf)?{...prior,refreshStatus:undefined}:v;});
   state.status='ready';state.retryAt=Date.now()+30000;
  }catch{state.status='unavailable';state.retryAt=Date.now()+60000;}
 })().finally(()=>pending.delete(id));pending.set(id,work);
}
function positionsFor(row){
 const entry=entries.get(key(row));
 return (row.positions||[]).map(p=>{
  if(!LEVERAGED.has(p.instrumentType))return p;
  const valid=entry?.token===signature(row),value=valid?entry.values?.find(v=>v.symbol===p.symbol&&v.instrumentType===p.instrumentType):null;
  const status=row.connection_status&&row.connection_status!=='active'?'unavailable':!adapters.has(row.broker_type)?'unsupported':value?.refreshStatus|| (value?.status==='sync_required'?'sync_required':value?.status==='unsupported'?'unsupported':value?.status==='unavailable'?'unavailable':valid?entry.status:'waiting');
  if(value?.status!=='current'||!Number.isFinite(value.value))return {...p,valuationStatus:status};
  return {...p,currentValue:value.value,valuationAsOf:value.asOf,valuationTimestampKind:value.timestampKind,valuationSource:value.source,valuationStatus:status};
 });
}
async function read(userId,accounts=[]){
 const saved=(await rows(userId)).filter(r=>!accounts.length||accounts.includes(r.account_identifier));
 const groups=new Map();
 for(const row of saved){
  schedule(row);
  for(const p of positionsFor(row).filter(p=>LEVERAGED.has(p.instrumentType))){
   const id=`${p.instrumentType}:${p.symbol}`,old=groups.get(id)||{symbol:p.symbol,instrumentType:p.instrumentType,accounts:[],quantity:0,capital:0,value:0,asOf:null,status:'ready',source:'Broker position valuation',timestampKind:'valuation'};
   old.accounts.push(row.account_identifier);old.quantity+=Number(p.quantity);old.capital+=Number(p.totalCost);
   if(p.currentValue==null||!Number.isFinite(Number(p.currentValue))||!Number.isFinite(Number(p.quantity))||!Number.isFinite(Number(p.totalCost))||!(Number(p.quantity)>0)||p.currency!=='USD')old.invalid=true;else old.value+=Number(p.currentValue);
   const date=p.valuationAsOf||new Date(row.synced_at).toISOString();if(!old.asOf||Date.parse(date)<Date.parse(old.asOf))old.asOf=date;
   const rank={current:0,ready:0,waiting:1,updating:2,unavailable:3,unsupported:4,sync_required:5};
   if((rank[p.valuationStatus||'waiting']||0)>(rank[old.status]||0))old.status=p.valuationStatus||'waiting';
   if(p.valuationTimestampKind!=='valuation')old.timestampKind='observed';
   if(p.valuationSource)old.source=p.valuationSource;
   groups.set(id,old);
  }
 }
 return {observedAt:new Date().toISOString(),positions:[...groups.values()].filter(g=>!g.invalid)};
}
async function scheduleAll(){
 if(scheduling)return;scheduling=true;
 try{for(const row of await rows(null))schedule(row);}catch{/* Retry later without logging private broker details. */}finally{scheduling=false;}
}
function start(){if(timer)return;void scheduleAll();timer=setInterval(()=>void scheduleAll(),30000);timer.unref?.();}
function stop(){clearInterval(timer);timer=null;}
module.exports={read,positionsFor,start,stop,scheduleAll,etoroValues,adapters,LEVERAGED};
