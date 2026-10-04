// Prototype rollout: deliberately refuses to write to the production database.
require('dotenv').config();
const db=require('../src/config/database');
(async()=>{
  if(process.env.APP_ENVIRONMENT!=='test' || process.env.DB_NAME!=='tradetally_test') throw Error('Run this prototype enrichment against the isolated test database only.');
  console.log(JSON.stringify(await require('../src/services/assetClassificationService').enrichExistingStocks()));
})().catch(()=>{console.error('Reference classification enrichment failed. No broker records were imported.');process.exitCode=1;}).finally(()=>db.pool.end());
