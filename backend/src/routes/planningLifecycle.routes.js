
const express=require('express');
const Joi=require('joi');
const {isDeepStrictEqual}=require('node:util');
const db=require('../config/database');
const {fail,calculate}=require('../services/tradePlanning');
const {accountIds,stageAccount}=require('../services/planningAccounts');
const {definitionForManagement}=require('../services/planningManagementRows');
const {sourceFills,verifyAllocation,ledger}=require('../services/planningLedger');
const brokerFills=require('../services/planBrokerFills');
const {resolvePlanningSymbols}=require('../services/planningAssetSymbols');
const router=express.Router();
const uuid=Joi.string().guid({version:['uuidv4','uuidv5']});
const validId=id=>{if(uuid.validate(id).error)fail('Invalid record ID',400)};
const run=fn=>async(req,res,next)=>{try{await fn(req,res,next)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
async function lock(c,req){
 validId(req.params.id);
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['planning:'+req.user.id]);
 const p=(await c.query('SELECT * FROM trade_plans WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id])).rows[0];
 if(!p)fail('Plan not found',404);
 if(req.body.version!==p.version)fail('Plan changed elsewhere. Reload before continuing.',409);
 return p;
}
async function evidence(c,p){
 const allocations=(await c.query('SELECT * FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2',[p.id,p.user_id])).rows;
 let trades=allocations.length?(await c.query('SELECT * FROM trades WHERE user_id=$1 AND id=ANY($2::uuid[])',[p.user_id,[...new Set(allocations.map(a=>a.trade_id))]])).rows:[];
 if(trades.some(t=>t.broker==='trading212')){
  const groups=await brokerFills.loadGroups(c,p.user_id);
  trades=brokerFills.attachSources(trades,allocations,groups);
 }
 const actualCurrencies=new Set(allocations.map(a=>a.source_snapshot.currency));
 const target=actualCurrencies.size===1?[...actualCurrencies][0]:p.definition.currency;
 let fx=null,working=p;
 if(target&&target!==p.definition.currency||actualCurrencies.size>1||accountIds(p.definition).length>1){
  fx=await require('../services/planningFx').latestPlanningFx();
  const rates={USD:1,...fx?.rates};working={...p,marketRates:rates};const from=Number(rates[p.definition.currency]),to=Number(rates[target]);
  if(from>0&&to>0)working={...working,stopConversion:to/from,...(actualCurrencies.size===1?{provisionalConversion:{currency:target,rate:to/from}}:{})};
 }
 const result=await require('../services/planningCashflows').enrich(c,working,ledger(working,allocations,trades),trades);
 if(fx)result.displayFx=fx;
 return result;
}
async function record(c,p,type,snapshot){
 await c.query('INSERT INTO trade_plan_events(plan_id,user_id,event_type,snapshot) VALUES($1,$2,$3,$4::jsonb)',[p.id,p.user_id,type,JSON.stringify(snapshot)]);
}
router.get('/library',run(async(req,res)=>{
 const tags=(await db.query('SELECT id,kind,name,definition FROM trade_plan_tags WHERE user_id=$1 ORDER BY kind,name',[req.user.id])).rows;
 const settings=(await db.query('SELECT settings FROM trade_planning_settings WHERE user_id=$1',[req.user.id])).rows[0]?.settings||{};
 const fx=await require('../services/planningFx').latestPlanningFx();
 res.json({tags,settings,fx});
}));



router.get('/calendar',run(async(req,res)=>{
 const year=Number(req.query.year);if(!Number.isInteger(year)||year<2000||year>2200)fail('Choose a valid calendar year');
 const events=(await db.query("WITH activity AS (SELECT e.plan_id,e.event_type,e.snapshot->>'action' AS action,CASE WHEN e.event_type='trade_linked' THEN COALESCE((e.snapshot->'source'->>'time')::timestamptz,e.created_at) ELSE e.created_at END AS occurred_at,p.status,p.definition->>'symbol' AS symbol,p.definition->>'title' AS title FROM trade_plan_events e JOIN trade_plans p ON p.id=e.plan_id WHERE e.user_id=$1 AND e.event_type IN ('ready','finalised','watching','trade_linked','reviewed','completed','stop_changed','option_rolled')) SELECT *,occurred_at AS created_at FROM activity WHERE occurred_at>=$2::date AND occurred_at<$3::date ORDER BY occurred_at",[req.user.id,year+'-01-01',(year+1)+'-01-01'])).rows;
 res.json({events});
}));
router.get('/recommendation',run(async(req,res)=>{
 const config=(await db.query('SELECT settings,updated_at FROM trade_planning_settings WHERE user_id=$1',[req.user.id])).rows[0];
 const plans=(await db.query("SELECT * FROM trade_plans WHERE user_id=$1 AND baseline IS NOT NULL",[req.user.id])).rows.filter(p=>p.definition.exposureSystem);
 const events=await Promise.all(plans.map(async p=>{
  const result=await evidence(db,p);
  const time=result.records.filter(a=>a.action==='exit').at(-1)?.fill.time||p.updated_at.toISOString();
  const afterCheckpoint=!config||new Date(time)>=new Date(config.updated_at);
  return {time,r:p.definition.currency===result.accountCurrency&&p.definition.currency!==result.currency?result.accountRealisedR:result.realisedR,afterCheckpoint,eligible:p.status==='completed'&&result.economicallyClosed&&p.review?.evidenceDigest===digest(result)};
 }));
 res.json(require('../services/planningExposure').recommend(config?.settings?.selectedLevel,events.filter(e=>e.afterCheckpoint)));
}));
router.get('/risk',run(async(req,res)=>res.json(await require('../services/planningRiskCoverage').load(db,req.user.id,evidence))));
router.post('/library',run(async(req,res)=>{
 const s=Joi.object({kind:Joi.string().valid('entry','exit','context').required(),name:Joi.string().trim().min(1).max(100).required(),definition:Joi.string().max(2000).allow('').default('')}).validate(req.body);
 if(s.error)fail('Provide a valid tag kind, name and definition');
 const t=s.value;
 const result=(await db.query('INSERT INTO trade_plan_tags(user_id,kind,name,definition) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,kind,name) DO UPDATE SET definition=EXCLUDED.definition RETURNING id,kind,name,definition',[req.user.id,t.kind,t.name,t.definition])).rows[0];
 res.status(201).json({tag:result});
}));
router.put('/settings',run(async(req,res)=>{
 const s=Joi.object({accountLimits:Joi.array().max(50).items(Joi.object({accountId:uuid.required(),limit:Joi.number().positive().allow(null).required(),equity:Joi.number().positive().allow(null).default(null),exposureMultiple:Joi.number().positive().max(20).allow(null).default(null),buyingPower:Joi.number().min(0).allow(null).default(null)})).default([]),tradingAccountIds:Joi.array().max(50).unique().items(uuid).allow(null).default(null),portfolioLimit:Joi.number().positive().allow(null).required(),currency:Joi.string().pattern(/^[A-Z]{3}$/).required(),selectedLevel:Joi.number().valid(.05,.1,.2,.3).required(),reason:Joi.string().trim().min(10).max(2000).required()}).validate(req.body);
 if(s.error)fail('Set the risk limit/currency, exposure level and a reason');
 const owned=(await db.query('SELECT id FROM user_accounts WHERE user_id=$1 AND is_archived=false',[req.user.id])).rows.map(a=>a.id);
 if([...(s.value.tradingAccountIds||[]),...s.value.accountLimits.map(a=>a.accountId)].some(id=>!owned.includes(id)))fail('Choose active accounts you own for risk settings');
 await db.query('INSERT INTO trade_planning_settings(user_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()',[req.user.id,JSON.stringify(s.value)]);
 res.json({settings:s.value});
}));
router.get('/journal-candidates',run(async(req,res)=>{
 const journal=require('../services/planningJournal'),today=await journal.sessionToday(db,req.user.id),date=req.query.date||today;
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(new Date(date+'T00:00:00Z').getTime())||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('Choose a valid session date');
 const entries=(await db.query("SELECT * FROM diary_entries WHERE user_id=$1 AND entry_type='diary' AND entry_date=$2::date ORDER BY created_at DESC LIMIT 100",[req.user.id,date])).rows.map(r=>({id:r.id,date:journal.dateOnly(r.entry_date),title:r.title,updatedAt:new Date(r.updated_at).toISOString(),revision:journal.revision(r),marketBias:r.market_bias}));
 res.json({today,date,entries});
}));
router.post('/:id/journal-assessments',run(async(req,res)=>{
 const journal=require('../services/planningJournal'),validated=journal.schema.validate(req.body,{convert:false});if(validated.error)fail(validated.error.details[0].message);
 let assessment;await db.withTransaction(async c=>{const p=await lock(c,req);if(!p.finalised||['completed','reviewed','cancelled'].includes(p.status))fail('Finalise or reopen this plan before recording journal evidence');
 assessment=await journal.capture(c,p,validated.value);const linked=[];
 if(validated.value.attachToExisting){const allocations=(await c.query("SELECT id,source_snapshot FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2 AND stage_key=$3 AND action='entry' AND journal_evidence IS NULL FOR UPDATE",[p.id,p.user_id,validated.value.stageKey])).rows;for(const a of allocations){await c.query('UPDATE trade_plan_allocations SET journal_evidence=$1::jsonb WHERE id=$2',[JSON.stringify(journal.association(assessment,a.source_snapshot.time)),a.id]);linked.push(a.id)}}
 await c.query('UPDATE trade_plans SET review=NULL,version=version+1,updated_at=NOW() WHERE id=$1',[p.id]);await record(c,p,'entry_journal_assessed',{assessment,linkedAllocationIds:linked});
 });res.status(201).json({assessment});
}));
router.get('/:id/workflow',run(async(req,res)=>{
 validId(req.params.id);
 const p=(await db.query('SELECT * FROM trade_plans WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];if(!p)fail('Plan not found',404);
 const result=await evidence(db,p);
 const history=(await db.query('SELECT event_type,created_at,snapshot FROM trade_plan_events WHERE plan_id=$1 AND user_id=$2 ORDER BY created_at',[p.id,req.user.id])).rows;
 const tradeReviews=(await db.query('SELECT r.trade_id,r.adherence_score,r.review_type,r.reviewed_at,r.followed_plan FROM trade_playbook_reviews r WHERE r.user_id=$1 AND r.trade_id IN (SELECT trade_id FROM trade_plan_allocations WHERE plan_id=$2 AND user_id=$1)',[p.user_id,p.id])).rows;
 const journalAssessments=(await db.query('SELECT * FROM trade_plan_journal_assessments WHERE plan_id=$1 AND user_id=$2 ORDER BY created_at DESC,id',[p.id,p.user_id])).rows;
 res.json({exitSizing:require('../services/planningExitSizing').state(p,result),journalAssessments,fx:result.displayFx||null,tradeReviews,ledger:result,history,review:p.review,reviewDraft:p.review_draft,baseline:p.baseline,needsUpdate:!!p.review&&p.review.evidenceDigest!==digest(result)});
}));
function digest(result){const evidence=result.records.map(a=>({id:a.id,q:a.quantity,fill:a.fill,valid:a.valid,...(a.journal_evidence?{journalEvidence:a.journal_evidence}:{})}));if(result.cashflows?.entries?.length)evidence.push({cashflows:result.cashflows.entries.map(e=>({id:e.id,fingerprint:e.fingerprint,status:e.status,fraction:e.fraction,treatment:e.treatment}))});return require('crypto').createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}

router.post('/:id/cashflows',run(async(req,res)=>{
 const input=Joi.object({version:Joi.number().integer().required(),cashEventId:uuid.required(),fingerprint:Joi.string().hex().length(64).required(),fraction:Joi.number().positive().max(1).required(),treatment:Joi.string().valid('include','already_included','exclude').required(),reason:Joi.string().trim().min(10).max(2000).required()}).validate(req.body,{convert:false});if(input.error)fail('Choose the cashflow, allocated percentage, treatment and reason');
 await db.withTransaction(async c=>{const p=await lock(c,req);if(['completed','reviewed','cancelled'].includes(p.status))fail('Reopen this plan before changing cashflow attribution');
 const event=(await c.query('SELECT id FROM broker_cash_events WHERE id=$1 AND user_id=$2 FOR UPDATE',[input.value.cashEventId,p.user_id])).rows[0];if(!event)fail('Cashflow not found',404);
 const result=await evidence(c,p),trades=(await c.query('SELECT * FROM trades WHERE user_id=$1 AND id=ANY($2::uuid[])',[p.user_id,[...new Set(result.records.map(r=>r.trade_id).filter(id=>id!=='provisional'))]])).rows;
 const saved=await require('../services/planningCashflows').save(c,p,result,trades,input.value);
 await c.query('UPDATE trade_plans SET review=NULL,version=version+1,updated_at=NOW() WHERE id=$1',[p.id]);await record(c,p,'cashflow_attributed',saved);
 });res.json({success:true});
}));
router.delete('/:id/cashflows/:linkId',run(async(req,res)=>{
 validId(req.params.linkId);if(typeof req.body.reason!=='string'||req.body.reason.trim().length<10||req.body.reason.length>2000)fail('Record why this attribution is being removed');
 await db.withTransaction(async c=>{const p=await lock(c,req);if(['completed','reviewed','cancelled'].includes(p.status))fail('Reopen this plan before changing cashflow attribution');const old=(await c.query('DELETE FROM trade_plan_cashflow_links WHERE id=$1 AND user_id=$2 AND plan_id=$3 RETURNING *',[req.params.linkId,p.user_id,p.id])).rows[0];if(!old)fail('Cashflow attribution not found',404);await c.query('UPDATE trade_plans SET review=NULL,version=version+1,updated_at=NOW() WHERE id=$1',[p.id]);await record(c,p,'cashflow_attribution_removed',{previous:old,reason:req.body.reason.trim()});});res.json({success:true});
}));
router.post('/:id/exit-sizing',run(async(req,res)=>{
 const schema=Joi.object({version:Joi.number().integer().required(),accountId:uuid.required(),entered:Joi.number().positive().required(),rows:Joi.array().max(20).items(Joi.object({key:Joi.string().max(64).required(),units:Joi.number().min(0).required()})).required(),reason:Joi.string().trim().min(10).max(2000).required()}).validate(req.body,{convert:false});if(schema.error)fail('Choose valid remaining exit quantities and a recheck reason');
 await db.withTransaction(async c=>{const p=await lock(c,req);if(!p.finalised||['completed','reviewed','cancelled'].includes(p.status))fail('Finalise or reopen this plan before revising remaining exits');const update=require('../services/planningExitSizing').confirm(p,await evidence(c,p),schema.value);await c.query('UPDATE trade_plans SET management=$1::jsonb,exit_sizing=$2::jsonb,review=NULL,version=version+1,updated_at=NOW() WHERE id=$3',[JSON.stringify(update.management),JSON.stringify(update.sizing),p.id]);await record(c,p,'exit_quantities_rechecked',update);});res.json({success:true});
}));
router.post('/:id/chart',run(async(req,res)=>{
 validId(req.params.id);
 const p=(await db.query('SELECT * FROM trade_plans WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];if(!p)fail('Plan not found',404);
 const url=p.definition.chartUrl;
 const match=/^https:\/\/(?:www\.)?tradingview\.com\/x\/([A-Za-z0-9_-]{1,64})\/?$/.exec(url);
 if(!match)fail('Use a published TradingView snapshot link to retain chart evidence');
 const exists=(await db.query('SELECT id FROM trade_plan_charts WHERE plan_id=$1 AND user_id=$2 AND source_url=$3',[p.id,p.user_id,url])).rows[0];
 if(exists)return res.json({retained:true});
 const id=match[1],response=await fetch('https://s3.tradingview.com/snapshots/'+id[0].toLowerCase()+'/'+id+'.png',{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))fail('TradingView snapshot is unavailable');
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>10*1024*1024){await response.body.cancel().catch(()=>{});fail('Snapshot exceeds the retained-image size limit')}chunks.push(Buffer.from(chunk))}
 const image=Buffer.concat(chunks);
 if(image.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail('Snapshot is not a valid PNG image');
 const hash=require('crypto').createHash('sha256').update(image).digest('hex');
 await db.query('INSERT INTO trade_plan_charts(plan_id,user_id,source_url,sha256,image) VALUES($1,$2,$3,$4,$5) ON CONFLICT(plan_id,source_url) DO NOTHING',[p.id,p.user_id,url,hash,image]);
 res.status(201).json({retained:true});
}));
router.get('/:id/chart',run(async(req,res)=>{
 validId(req.params.id);
 const row=(await db.query("SELECT c.image FROM trade_plan_charts c JOIN trade_plans p ON p.id=c.plan_id WHERE c.plan_id=$1 AND c.user_id=$2 AND c.source_url=p.definition->>'chartUrl' LIMIT 1",[req.params.id,req.user.id])).rows[0];if(!row)fail('Retained snapshot not found',404);
 res.set('Cache-Control','private, no-store').type('png').send(row.image);
}));
router.get('/:id/fills',run(async(req,res)=>{
 validId(req.params.id);
 const p=(await db.query('SELECT * FROM trade_plans WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];if(!p)fail('Plan not found',404);
 const roll=req.query.purpose==='roll';if(req.query.purpose&&(!roll||p.definition.instrument!=='option'))fail('Choose a valid trade finder purpose');
 const requestedAccount=req.query.accountId||p.definition.accountId;
 if(!accountIds(p.definition).includes(requestedAccount))fail('Choose an account selected for this plan');
 const account=(await db.query('SELECT account_identifier,broker FROM user_accounts WHERE id=$1 AND user_id=$2',[requestedAccount,req.user.id])).rows[0];
 if(!account?.account_identifier)return res.json({fills:[]});
 const assetSymbols=account.broker==='trading212'&&p.definition.instrument==='stock'?await resolvePlanningSymbols(db,req.user.id,account,p.definition.symbol):[p.definition.symbol.toUpperCase()];
 const d=p.definition,o=d.options||{},exactOption=d.instrument==='option'&&!roll;
 const trades=(await db.query(`SELECT * FROM trades WHERE user_id=$1 AND (UPPER(symbol)=UPPER($2) OR UPPER(underlying_symbol)=UPPER($2) OR UPPER(symbol)=ANY($11::text[]))
 AND account_identifier=$3 AND COALESCE(instrument_type,'stock')=$4 AND side=$5
 AND ($6::boolean OR (strike_price=$7 AND expiration_date::date=$8::date AND option_type=$9 AND contract_size=$10))
 ORDER BY entry_time DESC`,[req.user.id,d.symbol,account.account_identifier,d.instrument,d.instrument==='option'?'long':d.direction,!exactOption,o.strike||null,o.expiry||null,o.type||null,o.multiplier||null,assetSymbols])).rows;
 const used=(await db.query('SELECT plan_id,stage_key,trade_id,source_key,quantity,source_snapshot FROM trade_plan_allocations WHERE user_id=$1',[req.user.id])).rows;
 const brokerTrades=trades.filter(t=>t.broker==='trading212'&&d.instrument==='stock'&&d.direction==='long');
 let originals=[];
 if(brokerTrades.length||(account.broker==='trading212'&&d.instrument==='stock'&&d.direction==='long')){const groups=await brokerFills.loadGroups(db,req.user.id,account.account_identifier,d.symbol,false,assetSymbols);originals=brokerFills.availableGroups(groups,used);}

 res.json({fills:[...originals,...trades.filter(t=>!(t.broker==='trading212'&&d.instrument==='stock'&&d.direction==='long')).flatMap(t=>sourceFills(t).map(f=>{const matches=used.filter(a=>a.trade_id===t.id&&a.source_key===f.key),allocated=matches.reduce((v,a)=>v+Number(a.quantity),0);return {...f,tradeId:t.id,account:t.account_identifier,allocated,sharedPlans:[...new Set(matches.map(a=>a.plan_id).filter(id=>id&&id!==p.id))],available:Math.max(0,f.quantity-allocated)}}))].filter(f=>f.available>1e-8)});
}));
router.post('/:id/allocations',run(async(req,res)=>{
 const fillSchema=Joi.object({tradeId:uuid.required(),sourceKey:Joi.string().max(500).required(),fingerprint:Joi.string().hex().length(64).required(),quantity:Joi.number().positive().required()});
 const single=fillSchema.keys({journalAssessmentId:uuid.allow(null).default(null),version:Joi.number().integer().required(),stageKey:Joi.string().max(64).required(),action:Joi.string().valid('entry','exit').required()});
 const batch=Joi.object({journalAssessmentId:uuid.allow(null).default(null),version:Joi.number().integer().required(),stageKey:Joi.string().max(64).required(),action:Joi.string().valid('entry','exit').required(),fills:Joi.array().items(fillSchema).min(1).max(50).required()});
 const schema=(req.body.fills?batch:single).validate(req.body);
 if(schema.error)fail('Provide a valid fill allocation');const body=schema.value;
 await db.withTransaction(async c=>{
  const p=await lock(c,req);
  if(!p.finalised||['cancelled','completed'].includes(p.status))fail('Finalise the plan before linking trades; completed plans retain their history');
  const exitSizingBefore=await evidence(c,p);
  const appendingReservedEntry=body.action==='entry'&&(await c.query("SELECT id FROM trade_plan_commitments WHERE plan_id=$1 AND user_id=$2 AND stage_key=$3 AND status='reserved'",[p.id,p.user_id,body.stageKey])).rows.length>0;
  if(body.fills&&!appendingReservedEntry&&(await c.query('SELECT id FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2 AND action=$3 AND stage_key=$4',[p.id,p.user_id,body.action,body.stageKey])).rows.length)fail('Unlink the current trades before replacing this row',409);
  for(const selected of body.fills||[body]){
  const b={...body,...selected};
  const source=(await c.query('SELECT * FROM trades WHERE id=$1 AND user_id=$2 FOR UPDATE',[b.tradeId,req.user.id])).rows[0];if(!source)fail('Trade not found',404);
  const canonical=b.sourceKey.startsWith('id:broker:');
  const groups=source.broker==='trading212'?await brokerFills.loadGroups(c,req.user.id,source.account_identifier,source.symbol,true):[];
  const group=groups.find(g=>g.valid&&(canonical?g.key===b.sourceKey&&g.parts.some(part=>part.tradeId===source.id):g.parts.some(part=>part.tradeId===source.id&&part.key===b.sourceKey)));
  const t=canonical&&group?{...source,...group.trade,id:source.id,user_id:source.user_id}:source;
  const f=canonical?group?.fill:sourceFills(t).find(f=>f.key===b.sourceKey);if(!f||f.fingerprint!==b.fingerprint)fail('Source fill changed. Reload the trade finder.',409);
  if(canonical&&f.action==='exit'&&brokerFills.originalSettlementReports(groups).canonical.get(group.key)?.status!=='complete')fail('Original broker exit settlement history needs reconciliation before linking',409);
  if(group){const all=(await c.query('SELECT plan_id,stage_key,trade_id,source_key,quantity,source_snapshot FROM trade_plan_allocations WHERE user_id=$1',[req.user.id])).rows;const sameOriginal=all.filter(a=>a.source_key===group.key||a.source_snapshot?.brokerExecution?.key===group.key);if(sameOriginal.some(a=>a.plan_id===p.id&&a.stage_key===b.stageKey))fail('This original fill is already linked to this row. Unlink it to change the allocated quantity.',409);if(sameOriginal.some(a=>a.source_snapshot.fingerprint!==f.fingerprint))fail('Another plan has a changed source link. Resolve it before sharing this fill.',409);const usedOriginal=brokerFills.usedQuantity(group,all);if(b.quantity+usedOriginal>group.quantity+1e-8)fail('Allocation exceeds the available original broker execution quantity',409);}
  const allocations=(await c.query('SELECT * FROM trade_plan_allocations WHERE user_id=$1 AND trade_id=$2 AND source_key=$3',[req.user.id,t.id,f.key])).rows;
  if(allocations.some(a=>a.plan_id===p.id&&a.stage_key===b.stageKey))fail('This fill is already linked to that row',409);
  if(allocations.some(a=>a.source_snapshot.fingerprint!==f.fingerprint))fail('Another plan has a changed source link. Resolve it before sharing this fill.',409);
  const used=allocations.reduce((s,a)=>s+Number(a.quantity),0);
  const assetSymbols=t.broker==='trading212'&&p.definition.instrument==='stock'&&String(t.symbol).toUpperCase()!==p.definition.symbol.toUpperCase()?await resolvePlanningSymbols(c,p.user_id,{broker:t.broker,account_identifier:t.account_identifier},p.definition.symbol):[];
  verifyAllocation(p,f,b.quantity,used,b.action,b.stageKey,t,assetSymbols);
  const account=(await c.query('SELECT account_identifier FROM user_accounts WHERE id=$1 AND user_id=$2',[stageAccount(definitionForManagement(p),b.action,b.stageKey),p.user_id])).rows[0];
  if(!account?.account_identifier||account.account_identifier!==t.account_identifier)fail('Trade account does not match the selected plan account');
  const current=await evidence(c,p);
  if(current.unresolved)fail('Resolve changed source fills before adding allocations',409);
  const candidate={id:'pending',trade_id:t.id,source_key:f.key,stage_key:b.stageKey,action:b.action,quantity:b.quantity,source_snapshot:f};
  const existing=(await c.query('SELECT * FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2',[p.id,p.user_id])).rows;
  if(!body.fills&&!appendingReservedEntry&&existing.some(a=>a.action===b.action&&a.stage_key===b.stageKey&&a.trade_id!==t.id))fail('Unlink the current trade before linking another trade to this row',409);
  const tradeIds=[...new Set([...existing.map(a=>a.trade_id),t.id])];
  let allTrades=(await c.query('SELECT * FROM trades WHERE user_id=$1 AND id=ANY($2::uuid[])',[p.user_id,tradeIds])).rows;
  if(canonical||existing.some(a=>a.source_snapshot?.brokerExecution))allTrades=brokerFills.attachSources(allTrades,[...existing,candidate],await brokerFills.loadGroups(c,p.user_id));
  if(ledger(p,[...existing,candidate],allTrades).overExit)fail('Exit exceeds linked entries in this account/contract or precedes them',409);
  const journalEvidence=b.action==='entry'?await require('../services/planningJournal').forAllocation(c,p,b.stageKey,f.time,body.journalAssessmentId):null;
  await c.query('INSERT INTO trade_plan_allocations(user_id,plan_id,trade_id,source_key,stage_key,action,quantity,source_snapshot,journal_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)',[p.user_id,p.id,t.id,f.key,b.stageKey,b.action,b.quantity,JSON.stringify(f),journalEvidence?JSON.stringify(journalEvidence):null]);
  let baseline=p.baseline;
  if(!baseline||baseline.originalRisk==null){
   let rate=1,rateDate=null,fxSource='same_currency';
   if((baseline?.currency||p.definition.currency)!==f.currency){
    if(f.transactionFx?.accountCurrency===(baseline?.currency||p.definition.currency)&&f.transactionFx.rate>0){rate=f.transactionFx.rate;rateDate=f.time.slice(0,10);fxSource='broker_execution';}else{
    const fx=(await c.query("SELECT rates,rate_date FROM fx_daily_rates WHERE base_code='USD' AND rate_date<=$1::date ORDER BY rate_date DESC LIMIT 1",[f.time.slice(0,10)])).rows[0];
    const from=(baseline?.currency||p.definition.currency)==='USD'?1:Number(fx?.rates?.[baseline?.currency||p.definition.currency]),to=f.currency==='USD'?1:Number(fx?.rates?.[f.currency]);
    if(!(from>0&&to>0))fail('Stored transaction-date FX is missing; refresh FX before linking this trade');
    rate=to/from;rateDate=fx.rate_date;fxSource='stored_daily';
    }
   }
   baseline={...(baseline||p.definition),recordedAt:baseline?.recordedAt||new Date().toISOString(),originalRisk:(baseline?.riskBudget||p.definition.riskBudget)*rate,originalRiskCurrency:f.currency,fxRate:rate,fxDate:rateDate,fxSource};
  }
  p.baseline=baseline;
  // Reconcile an unfilled reservation when its actual entry is allocated.
  if(b.action==='entry')await require('../services/planningCommitments').reconcileRow(c,p,b.stageKey);
  await record(c,p,'trade_linked',{tradeId:t.id,sourceKey:f.key,stageKey:b.stageKey,action:b.action,quantity:b.quantity,source:f});
  }
  const exitSizing=require('../services/planningExitSizing').initialise(p,exitSizingBefore,await evidence(c,p));
  await c.query("UPDATE trade_plans SET baseline=$1::jsonb,status='entered',review=NULL,version=version+1,updated_at=NOW(),exit_sizing=$3::jsonb WHERE id=$2",[JSON.stringify(p.baseline),p.id,JSON.stringify(exitSizing)]);
 });
 res.status(201).json({success:true});
}));
router.delete('/:id/row-allocations',run(async(req,res)=>{
 const schema=Joi.object({version:Joi.number().integer().required(),stageKey:Joi.string().max(64).required(),action:Joi.string().valid('entry','exit').required()}).validate(req.body);
 if(schema.error)fail('Choose a valid linked row');const b=schema.value;
 await db.withTransaction(async c=>{
  const p=await lock(c,req);if(p.status==='completed')fail('Reopen the review before correcting a completed plan');
  const removed=(await c.query('DELETE FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2 AND action=$3 AND stage_key=$4 RETURNING *',[p.id,p.user_id,b.action,b.stageKey])).rows;
  if(!removed.length)fail('No trade is linked to this row',404);
  const management=JSON.parse(JSON.stringify(p.management||{}));if(management[b.action]?.[b.stageKey])management[b.action][b.stageKey].executed=false;
  const result=await evidence(c,{...p,management});
  const hasExecutions=result.records.length>0,nextStatus=hasExecutions?'entered':'watching',baseline=hasExecutions?p.baseline:null;
  for(const a of removed)await record(c,p,'trade_unlinked',{allocation:a,reason:'Unlinked from ladder row by user',previousBaseline:p.baseline});
  await c.query('UPDATE trade_plans SET management=$1::jsonb,baseline=$2::jsonb,status=$3,review=NULL,version=version+1,updated_at=NOW() WHERE id=$4',[JSON.stringify(management),JSON.stringify(baseline),nextStatus,p.id]);
  if(nextStatus==='watching'&&p.status!=='watching')await record(c,p,'watching',{previousStatus:p.status,status:'watching',reason:'No linked or provisional executions remain'});
 });res.json({success:true});
}));
router.delete('/:id/allocations/:allocationId',run(async(req,res)=>{
 validId(req.params.allocationId);if(typeof req.body.reason!=='string'||req.body.reason.trim().length<10)fail('Record why this allocation is being corrected');
 await db.withTransaction(async c=>{
  const p=await lock(c,req);if(p.status==='completed')fail('Reopen the review before correcting a completed plan');
  const a=(await c.query('DELETE FROM trade_plan_allocations WHERE id=$1 AND plan_id=$2 AND user_id=$3 RETURNING *',[req.params.allocationId,p.id,p.user_id])).rows[0];if(!a)fail('Allocation not found',404);
  await record(c,p,'trade_unlinked',{allocation:a,reason:req.body.reason.trim()});
  await c.query("UPDATE trade_plans SET status='entered',review=NULL,version=version+1,updated_at=NOW() WHERE id=$1",[p.id]);
 });res.json({success:true});
}));

router.put('/:id/management',run(async(req,res)=>{
 const stage=Joi.object({label:Joi.string().max(120).required(),accountId:uuid.allow(null).default(null),riskWeight:Joi.number().min(0).max(100).default(0)});
 const row=Joi.object({stage,percent:Joi.number().min(0).max(100),premium:Joi.number().positive().allow(null),executed:Joi.boolean().required(),units:Joi.number().min(0).allow(null).required(),price:Joi.number().positive().allow(null).required(),time:Joi.string().isoDate().required(),tactics:Joi.array().max(20).items(Joi.string().max(100)).default([]),marketContext:Joi.array().max(20).items(Joi.string().max(100)).default([])});
 const schema=Joi.object({version:Joi.number().integer().required(),management:Joi.object({entry:Joi.object().pattern(/^[a-zA-Z0-9_-]{1,64}$/,row).default({}),exit:Joi.object().pattern(/^[a-zA-Z0-9_-]{1,64}$/,row).default({})}).required()}).validate(req.body);
 if(schema.error)fail('Provide valid management quantities, levels and tags');
 await db.withTransaction(async c=>{
  const p=await lock(c,req);if(!p.finalised||['cancelled','completed','reviewed'].includes(p.status))fail('Finalise or reopen this plan before recording management changes');
  const m=schema.value.management;
  const nextDefinition=definitionForManagement({...p,management:m});
  for(const kind of ['entry','exit']){
   if(Object.keys(m[kind]).length>40)fail('Management ladders support at most 40 rows each');
   for(const [key,r] of Object.entries(m[kind]))if(r.stage){
    if(p.definition[kind==='entry'?'entries':'exits'].some(e=>e.key===key))fail('Original plan rows cannot be replaced by management rows');
    if(key.startsWith('roll_'))fail('Option roll rows must be created through the roll action');
    if(r.stage.accountId&&!accountIds(p.definition).includes(r.stage.accountId))fail('Choose a selected plan account for each management row');
   }
  }
  for(const kind of ['entry','exit'])for(const key of Object.keys(m[kind])){
   if(!(kind==='exit'&&key==='runner')&&!nextDefinition[kind==='entry'?'entries':'exits'].some(e=>e.key===key))fail('Management row does not belong to this plan');
   const r=m[kind][key];if(r.executed&&(!(r.units>0)||!(r.price>0)))fail('Executed rows require a quantity and execution level');
   if(p.definition.instrument==='option'&&r.units!=null&&!Number.isInteger(r.units))fail('Options require whole contract quantities');
  }
  const allocated=(await c.query('SELECT action,stage_key FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2',[p.id,p.user_id])).rows;
  for(const a of allocated){const r=m[a.action]?.[a.stage_key],before=p.management?.[a.action]?.[a.stage_key];if(before?.stage&&(!r?.stage||!isDeepStrictEqual(before.stage,r.stage)))fail('Linked management rows cannot be removed or reassigned');if(r)r.executed=true;}
  const canonical=value=>Object.fromEntries(['entry','exit'].map(kind=>[kind,Object.fromEntries(Object.entries(value?.[kind]||{}).map(([key,r])=>[key,{...r,time:new Date(r.time).toISOString(),tactics:r.tactics||[],marketContext:r.marketContext||[]}]))]));
  if(isDeepStrictEqual(canonical(m),canonical(p.management)))return;
  const before=await evidence(c,p);const next={...p,management:m};const result=await evidence(c,next);if(result.overExit)fail('Provisional exits exceed the available linked/provisional entries');
  const hasExecuted=Object.values(m.entry).some(r=>r.executed)||allocated.some(a=>a.action==='entry');
  const returnedToWatching=p.status==='entered'&&!hasExecuted;
  const nextStatus=hasExecuted?'entered':returnedToWatching?'watching':p.status;
  const baseline=returnedToWatching&&p.baseline?.source==='user_reported'?null:p.baseline||(hasExecuted?{...p.definition,recordedAt:new Date().toISOString(),source:'user_reported'}:null);
  await c.query("UPDATE trade_plans SET management=$1::jsonb,baseline=$2::jsonb,status=$3,version=version+1,updated_at=NOW(),exit_sizing=$5::jsonb WHERE id=$4",[JSON.stringify(m),JSON.stringify(baseline),nextStatus,p.id,JSON.stringify(require('../services/planningExitSizing').initialise(p,before,result))]);
  await record(c,p,'management_updated',{previous:p.management,next:m,source:'user_reported',previousStatus:p.status,status:nextStatus});
  if(returnedToWatching)await record(c,p,'watching',{previousStatus:p.status,status:'watching',reason:'All provisional entry marks removed; no entry trades linked'});
 });res.json({success:true});
}));
router.post('/:id/stop',run(async(req,res)=>{
 const s=Joi.object({version:Joi.number().integer().required(),stopPrice:Joi.number().positive().required(),reason:Joi.string().trim().min(3).max(2000).required()}).validate(req.body);
 if(s.error)fail('A positive SL invalidation level and a reason are required');
 await db.withTransaction(async c=>{
  const p=await lock(c,req);if(['cancelled','completed','reviewed'].includes(p.status))fail('Reopen the plan review before changing its stop');
  const previous=p.definition.stopPrice;const next={...p.definition,stopPrice:s.value.stopPrice};
  await c.query('UPDATE trade_plans SET definition=$1::jsonb,review=NULL,version=version+1,updated_at=NOW() WHERE id=$2',[JSON.stringify(next),p.id]);
  await record(c,p,'stop_changed',{previous,next:s.value.stopPrice,currency:p.definition.currency,reason:s.value.reason,source:'manual',actor:p.user_id});
 });res.json({success:true});
}));

router.post('/:id/roll',run(async(req,res)=>{
 const selection=Joi.object({tradeId:uuid.required(),sourceKey:Joi.string().max(500).required(),fingerprint:Joi.string().hex().length(64).required(),quantity:Joi.number().integer().positive().required()});
 const schema=Joi.object({version:Joi.number().integer().required(),close:selection.required(),open:selection.required(),delta:Joi.number().positive().required(),reason:Joi.string().trim().min(10).max(2000).required()}).validate(req.body);
 if(schema.error)fail('Select both roll fills, quantities, new share-equivalent delta and a reason');
 const b=schema.value;
 await db.withTransaction(async c=>{
  const p=await lock(c,req);if(p.definition.instrument!=='option'||p.status!=='entered')fail('Rolls require an entered single-leg option plan');
  if(require('../services/planningAccounts').accountIds(p.definition).length>1)fail('Option rolls currently require a separate plan per account');const result=await evidence(c,p);if(!result.coverageComplete||result.openQuantity<=0)fail('Reconcile current option exposure before rolling');
  const chosen=[];
  for(const [action,choice] of [['exit',b.close],['entry',b.open]]){
   const t=(await c.query('SELECT * FROM trades WHERE id=$1 AND user_id=$2 FOR UPDATE',[choice.tradeId,p.user_id])).rows[0];if(!t)fail('Roll trade not found',404);
   const f=sourceFills(t).find(f=>f.key===choice.sourceKey);
   if(!f||f.fingerprint!==choice.fingerprint||!f.costsVerified)fail('Roll source changed or costs are unresolved',409);
   if(f.action!==action||t.instrument_type!=='option'||t.side!=='long'||String(t.underlying_symbol||t.symbol).toUpperCase()!==p.definition.symbol.toUpperCase())fail('Roll fills must be directional option contracts for this underlying');
   const account=(await c.query('SELECT account_identifier FROM user_accounts WHERE id=$1 AND user_id=$2',[p.definition.accountId,p.user_id])).rows[0];if(account?.account_identifier!==t.account_identifier)fail('Roll fills must belong to this plan account');
   const used=(await c.query('SELECT COALESCE(SUM(quantity),0) AS quantity FROM trade_plan_allocations WHERE user_id=$1 AND trade_id=$2 AND source_key=$3',[p.user_id,t.id,f.key])).rows[0];
   if(choice.quantity+Number(used.quantity)>f.quantity+1e-8)fail('Roll quantity exceeds the available fill',409);
   chosen.push({t,f,choice,action});
  }
  const [close,open]=chosen;
  const o=p.definition.options;
  if(close.f.contract.strike!==String(o.strike)&&Number(close.f.contract.strike)!==o.strike)fail('Closing roll contract does not match the selected contract');
  if(close.f.contract.type!==o.type||close.f.contract.expiry!==o.expiry.slice(0,10)||open.f.contract.type!==o.type||close.f.currency!==open.f.currency||open.f.multiplier!==close.f.multiplier)fail('Roll contract type, multiplier and currency must be consistent');
  if(open.choice.quantity>close.choice.quantity||close.choice.quantity>result.openQuantity)fail('A roll cannot add contracts or close more than the current position');
  const credit=close.choice.quantity*close.f.price*close.f.multiplier-open.choice.quantity*open.f.price*open.f.multiplier-close.f.costs*close.choice.quantity/close.f.quantity-open.f.costs*open.choice.quantity/open.f.quantity;
  if(!(credit>0))fail('Only a positive net-credit roll after costs is permitted');
  if(b.delta*open.choice.quantity>o.contractDelta*close.choice.quantity)fail('New delta exposure exceeds the contracts being rolled');
  const key='roll_'+require('crypto').randomUUID().replaceAll('-','');
  const allocations=(await c.query('SELECT * FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2',[p.id,p.user_id])).rows;
  const candidate=chosen.map((a,i)=>({id:key+i,trade_id:a.t.id,source_key:a.f.key,stage_key:key+'_'+a.action,action:a.action,quantity:a.choice.quantity,source_snapshot:a.f}));
  const tradeIds=[...new Set([...allocations.map(a=>a.trade_id),...chosen.map(a=>a.t.id)])];
  const trades=(await c.query('SELECT * FROM trades WHERE user_id=$1 AND id=ANY($2::uuid[])',[p.user_id,tradeIds])).rows;
  if(ledger(p,[...allocations,...candidate],trades).overExit)fail('Roll closing fill exceeds that contract exposure or precedes its entries');
  for(const a of candidate)await c.query('INSERT INTO trade_plan_allocations(user_id,plan_id,trade_id,source_key,stage_key,action,quantity,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[p.user_id,p.id,a.trade_id,a.source_key,a.stage_key,a.action,a.quantity,JSON.stringify(a.source_snapshot)]);
  const definition={...p.definition,options:{...o,contract:open.t.symbol,strike:Number(open.t.strike_price),expiry:open.f.contract.expiry,premium:open.f.price,multiplier:open.f.multiplier,contractDelta:b.delta}};
  await c.query("UPDATE trade_plans SET definition=$1::jsonb,review=NULL,version=version+1,updated_at=NOW() WHERE id=$2",[JSON.stringify(definition),p.id]);
  await record(c,p,'option_rolled',{reason:b.reason,netCredit:credit,currency:close.f.currency,previousContract:o,nextContract:definition.options,allocations:candidate,source:'linked_fills'});
 });res.status(201).json({success:true});
}));

router.put('/:id/review-draft',run(async(req,res)=>{
 const schema=Joi.object({version:Joi.number().integer().required(),notes:Joi.string().max(10000).allow('').required(),entryAssessment:Joi.string().max(5000).allow('').required(),exitAssessment:Joi.string().max(5000).allow('').required(),journalExceptionReason:Joi.string().max(2000).allow('').default(''),processFollowed:Joi.boolean().required()}).validate(req.body);
 if(schema.error)fail('Provide valid review notes and assessments');
 await db.withTransaction(async c=>{
  const p=await lock(c,req);if(['completed','cancelled'].includes(p.status))fail('Reopen this plan before editing its review');
  const result=await evidence(c,p);
  await c.query("UPDATE trade_plans SET review_draft=$1::jsonb,status=$2,version=version+1,updated_at=NOW() WHERE id=$3",[JSON.stringify(schema.value),result.economicallyClosed?'under_review':p.status,p.id]);
  await record(c,p,'review_draft_saved',{notes:schema.value.notes,entryAssessment:schema.value.entryAssessment,exitAssessment:schema.value.exitAssessment});
 });res.json({success:true});
}));
router.post('/:id/review',run(async(req,res)=>{
 const schema=Joi.object({version:Joi.number().integer().required(),notes:Joi.string().trim().min(3).max(10000).required(),entryAssessment:Joi.string().max(5000).allow('').default(''),exitAssessment:Joi.string().max(5000).allow('').default(''),journalExceptionReason:Joi.string().max(2000).allow('').default(''),processFollowed:Joi.boolean().required()}).validate(req.body);
 if(schema.error)fail('Complete the review notes and process assessment');
 await db.withTransaction(async c=>{
  const p=await lock(c,req);if(p.status==='completed')fail('Reopen this completed review first');
  await require('../services/planningCommitments').requireResolved(c,p);const result=await evidence(c,p);if(result.cashflows?.unresolved)fail('Resolve changed cashflow sources or missing transaction-date FX before completing review');if(!result.economicallyClosed)fail('Review completion requires all linked exposure to be exited and source evidence reconciled');
  const missingJournal=result.records.filter(a=>a.action==='entry'&&!a.fill.provisional&&!a.journal_evidence);if(missingJournal.length&&schema.value.journalExceptionReason.trim().length<10)fail('Record why entry journal evidence is missing before completing review');
  const review={...schema.value,missingJournalEntryIds:missingJournal.map(a=>a.id),evidenceDigest:digest(result),result,completedAt:new Date().toISOString()};
  await c.query("UPDATE trade_plans SET review=$1::jsonb,status='reviewed',version=version+1,updated_at=NOW() WHERE id=$2",[JSON.stringify(review),p.id]);
  await record(c,p,'reviewed',review);
 });res.json({success:true});
}));
router.post('/:id/complete',run(async(req,res)=>{
 await db.withTransaction(async c=>{
  const p=await lock(c,req);await require('../services/planningCommitments').requireResolved(c,p);const result=await evidence(c,p);
  if(p.status!=='reviewed'||!p.review||!result.economicallyClosed||p.review.evidenceDigest!==digest(result))fail('Finish an up-to-date review before closing the plan');
  await c.query("UPDATE trade_plans SET status='completed',version=version+1,updated_at=NOW() WHERE id=$1",[p.id]);
  await record(c,p,'completed',{reviewedAt:p.review.completedAt});
 });res.json({success:true});
}));
router.post('/:id/reopen-review',run(async(req,res)=>{
 if(typeof req.body.reason!=='string'||req.body.reason.trim().length<10)fail('Record why this review is being reopened');
 await db.withTransaction(async c=>{const p=await lock(c,req);if(!['completed','reviewed'].includes(p.status))fail('Only a reviewed or completed plan can reopen its review');await c.query("UPDATE trade_plans SET status='under_review',review=NULL,version=version+1,updated_at=NOW() WHERE id=$1",[p.id]);await record(c,p,'review_reopened',{reason:req.body.reason,previousReview:p.review});});
 res.json({success:true});
}));

async function assertEdits(c,p,d){
 p={...p,definition:require('../services/tradePlanning').normalize(p.definition)};
 const a=(await c.query('SELECT action,stage_key FROM trade_plan_allocations WHERE plan_id=$1 AND user_id=$2',[p.id,p.user_id])).rows;
 if(['completed','reviewed'].includes(p.status))fail('Reopen the review before editing a completed plan');
 if(a.length){
  for(const k of ['symbol','instrument','direction','accountId','accountIds','currency','options'])if(!require('util').isDeepStrictEqual(d[k]??(k==='accountIds'?[]:null),p.definition[k]??(k==='accountIds'?[]:null)))fail('Linked trades lock the asset, account, currency and contract');
  if(d.stopPrice!==p.definition.stopPrice)fail('Use the SL change action and record a reason');
  for(const row of a){const k=row.action==='entry'?'entries':'exits';const before=p.definition[k].find(e=>e.key===row.stage_key)||(row.action==='exit'&&row.stage_key==='runner'&&p.definition.runnerMode==='legacy'?{key:'runner',label:'Runner',price:p.definition.runnerEstimatePrice,percent:100-p.definition.exits.reduce((s,e)=>s+e.percent,0),units:null,premium:null,marketContext:[],tactics:[]}:undefined);const after=d[k]?.find(e=>e.key===row.stage_key);if(!require('util').isDeepStrictEqual({...before,accountId:before?.accountId||null},{...after,accountId:after?.accountId||null}))fail('Linked ladder rows are locked; correct their allocation first');}
 }
}
router.evidence=evidence;
module.exports=router;
module.exports.assertEdits=assertEdits;
