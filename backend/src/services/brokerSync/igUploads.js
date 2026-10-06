const db=require('../../config/database');
const crypto=require('crypto');
const pdf=require('./igPdf');
const {prepare}=require('./igStatement');
const {importAccounts}=require('./igImport');
const previews=new Map(),active=new Set();
const reject=message=>{throw Error(`IG upload: ${message}`);};
const required=kind=>kind==='spread_bet'?['transactions','activity','breakdown','trading','ledger']:['transactions','trading','ledger'];
async function saved(userId) {
  const rows=(await db.query(`SELECT a.id,a.account_name,s.payload,s.captured_at FROM user_accounts a
    JOIN broker_import_snapshots s ON s.user_id=a.user_id AND s.account_identifier=a.account_identifier AND s.broker_type='ig'
    WHERE a.user_id=$1 AND a.broker='ig' AND NOT a.is_archived ORDER BY a.account_name`,[userId])).rows;
  if(!rows.length||rows.some(r=>!r.payload?.igFileInput?.ledgerAccountId))reject('The IG accounts need their statement identities configured before uploading.');
  return {rows,revision:crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>[r.id,r.captured_at,r.payload]))).digest('hex')};
}
async function accounts(userId) {
  const {rows}=await saved(userId);
  return rows.map(r=>({id:r.id,name:r.account_name,kind:r.payload.igFileInput.kind,required:required(r.payload.igFileInput.kind),csvReconciliation:r.payload.igFileInput.kind==='share_dealing'}));
}
async function preview(userId,files) {
  if(active.has(userId))reject('An IG import is already running. Please wait for it to finish.');
  active.add(userId);
  try {
    if(!files.length||files.reduce((sum,f)=>sum+f.size,0)>30*1024*1024)reject('Upload up to 30 MB of reports in total.');
    const base=await saved(userId),uploads=new Map();
    for(const f of files) {
      const match=f.fieldname.match(/^([0-9a-f-]{36}):(transactions|activity|breakdown|trading|ledger|execution|daily)$/);
      if(!match||!base.rows.some(r=>r.id===match[1]))reject('An uploaded file does not belong to a selected account.');
      if(!uploads.has(match[1]))uploads.set(match[1],{});
      const fields=uploads.get(match[1]);
      if(['execution','daily'].includes(match[2])) {
        const kind=base.rows.find(r=>r.id===match[1]).payload.igFileInput.kind;
        if(match[2]==='execution'&&kind!=='share_dealing')reject('Earlier trade statements are for share-dealing accounts.');
        if(match[2]==='daily'&&kind!=='spread_bet')reject('Daily equity statements are for spread-betting accounts.');
        (fields[match[2]]||=[]).push(f);
      } else {
        if(fields[match[2]])reject('Upload one file for each report type.');
        fields[match[2]]=f;
      }
    }
    const inputs=[];
    for(const row of base.rows) {
      const original=row.payload.igFileInput,fields=uploads.get(row.id);
      if(!fields){inputs.push(original);continue;}
      const needed=required(original.kind);
      const dailyOnly=Object.keys(fields).every(k=>k==='daily');
      const csvOnly=Object.keys(fields).length===1&&fields.transactions;
      if(csvOnly){inputs.push(await require('./igCsvReconciliation').reconcile(userId,original,fields.transactions.buffer.toString('utf8')));continue;}
      if(!dailyOnly&&(needed.some(k=>!fields[k])||Object.keys(fields).some(k=>!needed.includes(k)&&!['execution','daily'].includes(k))))reject('Please include every requested report for each selected account.');
      const updated={...original};
      if(!dailyOnly) {
      for(const k of needed.filter(k=>!['trading','ledger'].includes(k)))updated[k]=fields[k].buffer.toString('utf8');
      const trading=await pdf.text(fields.trading.buffer),ledger=await pdf.text(fields.ledger.buffer);
      if(original.kind==='share_dealing') {
        const shares=require('./igShares');
        updated.shareLegacyHoldings=original.shareLegacyHoldings||original.confirmation.holdings;
        updated.shareTrades=shares.mergeTrades(original.shareTrades||[],shares.statementTrades(trading));
        for(const f of fields.execution||[])updated.shareTrades=shares.mergeTrades(updated.shareTrades,shares.statementTrades(await pdf.text(f.buffer)));
      }
      updated.confirmation=pdf.confirmation(original,trading,ledger,updated.transactions);
      if(original.kind==='share_dealing')updated.shareSecurities=[...new Map([
        ...updated.shareTrades.map(t=>({name:t.name,isin:t.isin,symbol:t.isin})),
        ...(original.shareSecurities||original.confirmation.holdings),...updated.confirmation.holdings
      ].map(h=>[h.isin,{name:h.name,symbol:h.symbol,isin:h.isin}])).values()];
      }
      const prepared=prepare(updated),points=new Map((original.statementValues||[]).map(p=>[p.date,p]));
      for(const f of fields.daily||[]) {
        const point=require('./igNavHistory').readSpreadStatement(await pdf.text(f.buffer),updated,
          {from_date:prepared.from,starting_cash:0,records:prepared.records});
        const prior=points.get(point.date);
        if(prior&&(prior.cash!==point.cash||prior.holdings!==point.holdings))reject('Daily statements disagree for the same date.');
        points.set(point.date,point);
      }
      // Only retain numeric valuations, never the uploaded PDF or its text.
      updated.statementValues=[...points.values()];
      prepare(updated);inputs.push(updated);
    }
    const result=await importAccounts(userId,inputs,{dryRun:true});
    const token=crypto.randomBytes(32).toString('hex');
    for(const [key,value] of previews)if(value.userId===userId||value.expires<Date.now())previews.delete(key);
    if(previews.size>=20)reject('Import previews are busy. Please try again shortly.');
    const identifiers=base.rows.filter(r=>uploads.has(r.id)).map(r=>prepare(r.payload.igFileInput).identifier);
    previews.set(token,{userId,inputs,identifiers,revision:base.revision,expires:Date.now()+15*60000});
    return {token,...result,accounts:result.accounts.filter(a=>base.rows.some(r=>uploads.has(r.id)&&r.account_name===a.name)),
      notice:'Cash balances match the trading statements. Internal transfers are excluded from external funding. The preview expires after 15 minutes.'};
  } finally {active.delete(userId);}
}
async function apply(userId,token) {
  const item=previews.get(token);
  if(!item||item.userId!==userId||item.expires<Date.now())reject('This preview has expired. Please preview your files again.');
  if(active.has(userId))reject('An IG import is already running. Please wait for it to finish.');
  active.add(userId);
  try {
    if((await saved(userId)).revision!==item.revision)reject('An account was updated after this preview. Please preview again.');
    await require('../backup.service').createFullSiteBackup(userId);
    const result=await importAccounts(userId,item.inputs,{dryRun:false});
    previews.delete(token);
    const dates=item.inputs.flatMap(i=>(i.statementValues||[]).map(p=>p.date));
    return {...result,portfolioHistory:await require('../manualPortfolioMaintenance').rebuild(userId,'ig',item.identifiers,dates.sort()[0]||null)};
  } finally {active.delete(userId);}
}
module.exports={accounts,preview,apply,required};
