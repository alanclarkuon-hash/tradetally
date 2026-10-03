const db=require('../../config/database');
const crypto=require('crypto');
const workbook=require('./etoroWorkbook');
const {prepare}=require('./etoroCashStatement');
const previews=new Map(),active=new Set();
const fail=message=>{throw Error(`eToro upload: ${message}`);};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
async function saved(userId,accountId,client=db) {
  const accounts=(await client.query(`SELECT a.*,c.id AS connection_id,c.broker_metadata FROM user_accounts a
    JOIN broker_connections c ON c.user_id=a.user_id AND c.broker_type='etoro' AND a.account_identifier=('eToro ****'||RIGHT(c.external_account_id,4))
    WHERE a.user_id=$1 AND a.broker='etoro' AND NOT a.is_archived ORDER BY a.account_name`,[userId])).rows;
  const account=accounts.find(a=>a.id===accountId);if(!account)fail('Select your managed eToro account.');
  const report=(await client.query(`SELECT * FROM broker_cash_reports WHERE user_id=$1 AND account_id=$2 AND broker_type='etoro'
    ORDER BY to_date DESC,updated_at DESC LIMIT 1`,[userId,accountId])).rows[0];
  if(!report||account.currency!=='USD'||report.currency!=='USD')fail('Existing USD statement history is required before updating here.');
  return {account,report,revision:hash([account.id,account.currency,account.is_archived,account.broker_metadata?.statement_identity_hash,report])};
}
async function accounts(userId) {
  return (await db.query(`SELECT a.id,a.account_name,MAX(r.to_date) AS through FROM user_accounts a
    JOIN broker_cash_reports r ON r.account_id=a.id AND r.user_id=a.user_id AND r.broker_type='etoro'
    WHERE a.user_id=$1 AND a.broker='etoro' AND NOT a.is_archived GROUP BY a.id ORDER BY a.account_name`,[userId])).rows
    .map(a=>({id:a.id,name:a.account_name,through:day(a.through)}));
}
function combine(base,upload) {
  const old=base.report.records;
  if(upload.end<day(base.report.to_date))fail('This statement ends before your saved history. Download one covering the latest date.');
  const identity=hash(upload.username);
  if(base.account.broker_metadata?.statement_identity_hash&&base.account.broker_metadata.statement_identity_hash!==identity)fail('The statement belongs to a different eToro account.');
  const initial=prepare(upload.statement),first=old.findIndex(r=>r.reference===initial.records[0].reference);
  if(first<0)fail('Start the statement earlier so it overlaps your saved account activity.');
  if(old.slice(0,first).some(r=>r.date>=upload.start))fail('The statement is missing earlier activity in its selected period.');
  const opening=Number(base.report.starting_cash)+old.slice(0,first).reduce((s,r)=>s+r.cash,0);
  const data=prepare(upload.statement,{startingCash:opening});
  const overlap=old.slice(first).filter(r=>r.date<=upload.end);
  if(data.records.length<overlap.length)fail('The statement is missing previously imported activity.');
  for(let n=0;n<overlap.length;n++)if(['reference','time','sourceType','type','amount','positionId'].some(k=>data.records[n][k]!==overlap[n][k])||Math.abs(data.records[n].cash-overlap[n].cash)>.000001)
    fail('Previously imported activity differs from this statement. No records have been changed.');
  const added=data.records.slice(overlap.length);
  if(added.some(r=>r.time<old.at(-1).time))fail('New activity is out of sequence.');
  const known=new Set(old.map(r=>r.sourceType));
  if(added.some(r=>!r.type&&!known.has(r.sourceType)))fail('A new activity type needs review before importing.');
  if(data.unmatchedDividendDates.some(date=>date>day(base.report.to_date)))fail('Some new dividend details do not match account activity. Download a statement with complete dividend details.');
  const records=[...old,...added];
  const computed=Number(base.report.starting_cash)+records.reduce((s,r)=>s+r.cash,0);
  if(Math.abs(computed-data.endingCash)>.005)fail('Cash activity does not reconcile with the closing balance.');
  return {records,added,identity,endingCash:data.endingCash,end:upload.end};
}
async function preview(userId,accountId,file) {
  if(active.has(userId))fail('A statement update is already running.');active.add(userId);
  try {
    if(!file?.buffer||!file.originalname?.toLowerCase().endsWith('.xlsx'))fail('Upload the XLSX account statement downloaded from eToro.');
    const base=await saved(userId,accountId),upload=await workbook.read(file.buffer),data=combine(base,upload);
    for(const [key,p] of previews)if(p.userId===userId||p.expires<Date.now())previews.delete(key);
    if(previews.size>=10)fail('Statement previews are busy. Please try again shortly.');
    const token=crypto.randomBytes(32).toString('hex');previews.set(token,{userId,accountId,revision:base.revision,data,expires:Date.now()+15*60000});
    const sum=types=>data.added.filter(r=>types.includes(r.type)).reduce((s,r)=>s+r.amount,0);
    return {token,account:base.account.account_name,from:upload.start,through:data.end,newRecords:data.added.length,
      matchedRecords:upload.statement['Account Activity'].length-data.added.length,newIncome:sum(['interest','dividend']),
      newDeposits:sum(['deposit']),newWithdrawals:-sum(['withdrawal']),newFees:-sum(['account_fee','tax']),
      previousCash:Number(base.report.ending_cash),closingCash:data.endingCash,cashChange:data.endingCash-Number(base.report.ending_cash)};
  } finally {active.delete(userId);}
}
async function apply(userId,token) {
  const p=previews.get(token);if(!p||p.userId!==userId||p.expires<Date.now())fail('This preview has expired. Preview the statement again.');
  if(active.has(userId))fail('A statement update is already running.');active.add(userId);
  try {
    if((await saved(userId,p.accountId)).revision!==p.revision)fail('The account changed after preview. Preview again.');
    await require('../backup.service').createFullSiteBackup(userId);
    const result=await db.withTransaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`etoro-statement:${p.accountId}`]);
      const base=await saved(userId,p.accountId,client);if(base.revision!==p.revision)fail('The account changed after preview. Preview again.');
      let events=0;
      for(const e of p.data.added.filter(r=>r.type)){
        const r=await client.query(`INSERT INTO broker_cash_events(user_id,account_id,broker_type,reference_id,event_type,event_date,amount,currency,amount_usd,description)
          VALUES($1,$2,'etoro',$3,$4,$5,$6,'USD',$6,$7) ON CONFLICT(user_id,account_id,broker_type,reference_id) DO NOTHING RETURNING id`,
        [userId,p.accountId,e.reference,e.type,e.date,e.amount,e.description]);events+=r.rowCount;
      }
      await client.query(`INSERT INTO broker_cash_reports(user_id,account_id,broker_type,from_date,to_date,currency,starting_cash,ending_cash,records)
        VALUES($1,$2,'etoro',$3,$4,'USD',$5,$6,$7::jsonb) ON CONFLICT(user_id,account_id,broker_type,from_date,to_date)
        DO UPDATE SET ending_cash=EXCLUDED.ending_cash,records=EXCLUDED.records,updated_at=NOW()`,
      [userId,p.accountId,day(base.report.from_date),p.data.end,base.report.starting_cash,p.data.endingCash,JSON.stringify(p.data.records)]);
      await client.query(`UPDATE broker_connections SET broker_metadata=COALESCE(broker_metadata,'{}'::jsonb)||jsonb_build_object('statement_identity_hash',$1::text)
        WHERE id=$2 AND user_id=$3`,[p.data.identity,base.account.connection_id,userId]);
      return {newRecords:p.data.added.length,newEvents:events,closingCash:p.data.endingCash,through:p.data.end};
    });previews.delete(token);return result;
  } finally {active.delete(userId);}
}
module.exports={accounts,combine,preview,apply};
