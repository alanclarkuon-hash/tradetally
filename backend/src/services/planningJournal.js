const crypto=require('crypto'),Joi=require('joi');
const {fail}=require('./tradePlanning'),{stageAccount}=require('./planningAccounts');
const dateOnly=v=>typeof v==='string'?v.slice(0,10):v instanceof Date?[v.getFullYear(),String(v.getMonth()+1).padStart(2,'0'),String(v.getDate()).padStart(2,'0')].join('-'):null;
function journalSnapshot(row){return {id:row.id,date:dateOnly(row.entry_date),title:row.title,content:row.content,marketBias:row.market_bias,keyLevels:row.key_levels,watchlist:row.watchlist||[],tags:row.tags||[],createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()}}
const revision=row=>crypto.createHash('sha256').update(JSON.stringify(journalSnapshot(row))).digest('hex');
async function sessionToday(c,userId){const u=(await c.query('SELECT timezone FROM users WHERE id=$1',[userId])).rows[0];return new Intl.DateTimeFormat('en-CA',{timeZone:u?.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
const schema=Joi.object({version:Joi.number().integer().required(),stageKey:Joi.string().max(64).required(),sessionDate:Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),journalId:Joi.string().guid().allow(null).default(null),journalRevision:Joi.string().hex().length(64).allow(null).default(null),journalReviewed:Joi.boolean().required(),positionsReviewed:Joi.boolean().required(),notes:Joi.string().max(5000).allow('').default(''),exceptionReason:Joi.string().max(2000).allow('').default(''),attachToExisting:Joi.boolean().default(false)});
function buildAssessment(input,row,today,now=new Date()){
 const sessionDate=input.sessionDate;if(!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)||!Number.isFinite(new Date(sessionDate+'T00:00:00Z').getTime())||new Date(sessionDate+'T00:00:00Z').toISOString().slice(0,10)!==sessionDate||sessionDate>today)fail('Choose a valid current or earlier journal session date');
 const exceptional=!row||!input.journalReviewed||!input.positionsReviewed||sessionDate!==today;
 if(exceptional&&input.exceptionReason.trim().length<10)fail('Record why journal/session evidence or review confirmations are missing or from an earlier session');
 if(row&&dateOnly(row.entry_date)!==sessionDate)fail('Journal entry does not belong to the selected session');
 if(row&&revision(row)!==input.journalRevision)fail('Journal changed. Refresh and review it before saving the assessment',409);
 return {journal:row?journalSnapshot(row):null,journalRevision:row?revision(row):null,sessionDate,recordedAt:now.toISOString(),journalReviewed:input.journalReviewed,positionsReviewed:input.positionsReviewed,notes:input.notes,exceptionReason:input.exceptionReason.trim(),status:exceptional?'exception':'confirmed',source:'user_assessment'};
}
async function capture(c,p,input){
 const row=p.definition.entries.find(e=>e.key===input.stageKey);if(!row)fail('Choose an entry row from this plan');
 const journal=input.journalId?(await c.query("SELECT * FROM diary_entries WHERE id=$1 AND user_id=$2 AND entry_type='diary' FOR SHARE",[input.journalId,p.user_id])).rows[0]:null;
 if(input.journalId&&!journal)fail('Journal entry not found',404);
 const snapshot=buildAssessment(input,journal,await sessionToday(c,p.user_id));
 const a=(await c.query('INSERT INTO trade_plan_journal_assessments(plan_id,user_id,stage_key,account_id,diary_entry_id,session_date,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *',[p.id,p.user_id,input.stageKey,stageAccount(p.definition,'entry',input.stageKey),input.journalId,input.sessionDate,JSON.stringify(snapshot)])).rows[0];
 return a;
}
function association(a,time){return {assessmentId:a.id,stageKey:a.stage_key,accountId:a.account_id,...a.snapshot,timing:new Date(a.snapshot.recordedAt)<=new Date(time)?'before_entry':'retrospective',entryTime:time}}
async function forAllocation(c,p,key,time,id){if(!id)return null;const a=(await c.query('SELECT * FROM trade_plan_journal_assessments WHERE id=$1 AND plan_id=$2 AND user_id=$3 AND stage_key=$4',[id,p.id,p.user_id,key])).rows[0];if(!a||a.account_id!==stageAccount(p.definition,'entry',key))fail('Choose a saved journal assessment for this entry and account');return association(a,time)}
async function forCommitment(c,p,key,id,reason){if(id&&Joi.string().guid().validate(id).error)fail('Choose a valid journal assessment');if(reason&&(typeof reason!=='string'||reason.trim().length<10||reason.length>2000))fail('Provide a journal exception reason between 10 and 2000 characters');
 if(!id){if(typeof reason!=='string'||reason.trim().length<10||reason.length>2000)fail('Select an entry journal assessment or record why it is missing');const a=await capture(c,p,{stageKey:key,sessionDate:await sessionToday(c,p.user_id),journalId:null,journalRevision:null,journalReviewed:false,positionsReviewed:false,notes:'',exceptionReason:reason.trim()});return {...a.snapshot,assessmentId:a.id};}
 const a=(await c.query('SELECT * FROM trade_plan_journal_assessments WHERE id=$1 AND plan_id=$2 AND user_id=$3 AND stage_key=$4',[id,p.id,p.user_id,key])).rows[0];if(!a||a.account_id!==stageAccount(p.definition,'entry',key))fail('Choose the journal assessment for this entry and account');
 const today=await sessionToday(c,p.user_id);const journal=a.diary_entry_id?(await c.query('SELECT * FROM diary_entries WHERE id=$1 AND user_id=$2 FOR SHARE',[a.diary_entry_id,p.user_id])).rows[0]:null;
 const changed=a.snapshot.journal&&(journal?revision(journal)!==a.snapshot.journalRevision:true);
 if((a.snapshot.sessionDate!==today||changed)&&(!reason||reason.trim().length<10))fail('Journal evidence changed or is from another session. Recheck it or record an exception');
 return {...a.snapshot,assessmentId:a.id,...(reason?{commitmentExceptionReason:reason.trim()}:{}),evidenceRecheckedAt:new Date().toISOString()};
}
module.exports={dateOnly,journalSnapshot,revision,sessionToday,schema,buildAssessment,capture,association,forAllocation,forCommitment};
