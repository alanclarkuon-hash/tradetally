const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {productionPaths,productionCompose}=require('./private-storage.cjs');
test('reject private storage in repository including nested folders',()=>{const r=path.resolve('repo');for(const p of [r,path.join(r,'private')])assert.throws(()=>productionPaths(r,p));});
test('all private files and compose env resolve outside repository',()=>{const r=path.resolve('repo'),base=path.resolve('external'),p=productionPaths(r,base);for(const v of Object.values(p))assert.ok(v.startsWith(base+path.sep));assert.ok(productionCompose(r,p).includes(p.env));});
