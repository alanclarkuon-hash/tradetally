const path=require('node:path');
const os=require('node:os');
function productionPaths(repoRoot,privateRoot=process.env.TRADETALLY_PRIVATE_DIR||path.join(os.homedir(),'TradeTally','Private')) {
 const base=path.resolve(privateRoot),relative=path.relative(path.resolve(repoRoot),base);
 if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Private storage must be outside the repository');
 const production=path.join(base,'production');
 return {env:path.join(production,'config','production.env'),secrets:path.join(production,'backup-secrets'),output:path.join(production,'backup-output'),staging:path.join(production,'backup-staging')};
}
function productionCompose(repoRoot,paths=productionPaths(repoRoot)) {return ['compose','--project-directory',repoRoot,'--env-file',paths.env,'-f',path.join(repoRoot,'compose.local.yaml')];}
module.exports={productionPaths,productionCompose};
