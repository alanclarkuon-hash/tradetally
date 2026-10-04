// Upgrade saved statement metadata only. No cash events or trades are imported.
const fs=require('fs');
const db=require('../src/config/database');
const {read}=require('../src/services/brokerSync/etoroWorkbook');
const {prepare}=require('../src/services/brokerSync/etoroCashStatement');
const {statementSplits}=require('../src/services/etoroHistoricalSplits');
(async()=>{
 if(process.env.APP_ENVIRONMENT!=='test')throw Error('Test environment required');
 const workbook=await read(fs.readFileSync(process.argv[2]));
 const records=prepare(workbook.statement).records;
 const source=new Map(records.filter(r=>['corp action: Split','Open Position'].includes(r.sourceType)).map(r=>[r.reference,r]));
 const splitRecords=records.filter(r=>r.sourceType==='corp action: Split');
 if(statementSplits(splitRecords).length!==splitRecords.length||!splitRecords.length)throw Error('Invalid split metadata');
 let reports=0,allocations=0;
 await db.withTransaction(async client=>{
  const saved=(await client.query("SELECT id,records FROM broker_cash_reports WHERE broker_type='etoro' FOR UPDATE")).rows;
  for(const report of saved) {
   let matched=0;
   const enriched=report.records.map(r=>{
    const original=source.get(r.reference);if(!original)return r;
    if(r.time!==original.time||r.positionId!==original.positionId||r.amount!==original.amount||Math.abs(r.cash-original.cash)>1e-8)throw Error('Statement metadata mismatch');
    matched++;return {...r,details:original.details,...(original.units?{units:original.units}:{})};
   });
   // Exact existing record references establish the account; never attach
   // metadata to unrelated reports or partly matched statement histories.
   if(!matched)continue;
   if(matched!==source.size)throw Error('Incomplete split overlap');
   await client.query('UPDATE broker_cash_reports SET records=$2::jsonb WHERE id=$1',[report.id,JSON.stringify(enriched)]);
   reports++;allocations=matched;
  }
  if(!reports)throw Error('No matching saved statement');
 });
 console.log(JSON.stringify({reports,openingAndSplitMetadata:allocations,positionSplitAllocations:splitRecords.length}));
 await db.pool.end();
})().catch(()=>{console.error('Split metadata enrichment failed; transaction rolled back.');process.exit(1);});
