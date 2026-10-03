const fs=require('fs');
const db=require('../src/config/database');
(async()=>{
 if(process.env.APP_ENVIRONMENT!=='test')throw Error('Statement history capture is restricted to test');
 const accounts=(await db.query("SELECT user_id,id FROM user_accounts WHERE broker='etoro' AND NOT is_archived")).rows;
 if(accounts.length!==1)throw Error('Exactly one managed eToro account is required');
 console.log(await require('../src/services/portfolioStatementHistoryService').captureEtoroStatement(accounts[0].user_id,accounts[0].id,fs.readFileSync(process.argv[2])));
 await db.pool.end();
})().catch(()=>{console.error('Statement equity was not captured: account identity or saved coverage needs review.');process.exit(1);});
