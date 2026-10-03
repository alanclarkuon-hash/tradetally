// Explicit offline reconstruction: test environment only. Public price reads
// are optional; broker credentials and broker APIs are never used here.
const db=require('../src/config/database');
const {reconstruct}=require('../src/services/portfolioReconstructionService');
(async()=>{
 if(process.env.APP_ENVIRONMENT!=='test')throw Error('Historical reconstruction is restricted to test');
 const users=(await db.query('SELECT id FROM users')).rows;
 for(const user of users)console.log(JSON.stringify(await reconstruct(user.id,{apply:process.argv.includes('--apply'),fetchPrices:process.argv.includes('--prices'),onProgress:p=>console.log(JSON.stringify(p))})));
 await db.pool.end();
})().catch(()=>{console.error('Historical reconstruction failed; previous reports were preserved.');process.exit(1);});
