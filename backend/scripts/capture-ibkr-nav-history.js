const fs=require('fs');
const db=require('../src/config/database');
const {decodeIBKRFlexReport}=require('../src/utils/ibkrFlexReport');
const {saveNavReports}=require('../src/services/brokerSync/ibkrNavHistory');
(async()=>{
 if(process.env.APP_ENVIRONMENT!=='test')throw Error('Statement capture is restricted to test');
 const path=process.argv[2];if(!path)throw Error('Statement path required');
 const decoded=decodeIBKRFlexReport(fs.readFileSync(path,'utf8'));
 const users=(await db.query("SELECT DISTINCT user_id FROM user_accounts WHERE broker='ibkr' AND NOT is_archived")).rows;
 if(users.length!==1)throw Error('Statement user is ambiguous');
 console.log(JSON.stringify(await saveNavReports({userId:users[0].user_id},decoded)));
 await db.pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
