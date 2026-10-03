#!/usr/bin/env node
// Input must remain in private storage, outside the source tree.
const fs=require('fs');
const db=require('../src/config/database');
(async()=>{
  const [path,userId,mode]=process.argv.slice(2);
  if(!path || !userId || !['--dry-run','--apply'].includes(mode))throw Error('Usage: import-ig-statements.js PRIVATE_JSON USER_ID --dry-run|--apply');
  const result=await require('../src/services/brokerSync/igImport').importAccounts(userId,JSON.parse(fs.readFileSync(path,'utf8')),{dryRun:mode==='--dry-run'});
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message?.startsWith('IG statement:')?error.message:'IG import stopped; no partial financial import was committed. Review privately.');process.exitCode=1;}).finally(()=>db.pool.end());
