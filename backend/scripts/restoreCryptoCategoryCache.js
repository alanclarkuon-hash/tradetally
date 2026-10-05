// Transfer public provider metadata only; no broker or account records.
const fs=require('node:fs/promises'),path=require('node:path');
const {mergeCategoryCache}=require('../src/utils/cryptoCategoryCache');
async function main(){
 if(process.env.APP_ENVIRONMENT!=='test')throw Error('Only the test environment is permitted');
 if(!process.argv[2])throw Error('Supply a saved category cache');
 const file=path.resolve(__dirname,'../src/data/coingecko-categories.json');
 const incoming=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 let existing={};try{existing=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const merged=mergeCategoryCache(existing,incoming);
 await fs.mkdir(path.dirname(file),{recursive:true});
 if(Object.keys(existing).length)await fs.copyFile(file,file+'.pre-restore');
 await fs.writeFile(file+'.restore',JSON.stringify(merged));
 await fs.rename(file+'.restore',file);
 console.log(JSON.stringify({success:true,records:Object.keys(merged).length}));
}
if(require.main===module)main().catch(()=>{console.error('Category cache restore refused or failed; existing data retained.');process.exitCode=1});
