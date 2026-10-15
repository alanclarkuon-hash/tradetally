const util=require('util');
jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/utils/logger',()=>Object.fromEntries(['logDebug','logError','info'].map(k=>[k,jest.fn()])));
jest.mock('../../src/utils/cache',()=>({get:jest.fn(),del:jest.fn(),data:{}}));
const db=require('../../src/config/database'),logger=require('../../src/utils/logger'),Cache=require('../../src/services/analyticsCache');
const marker='SYNTHETIC-PRIVATE-CACHE';
beforeEach(()=>jest.clearAllMocks());
test.each(['hit','miss','failure'])('persistent cache %s preserves behavior without exposing user, filter-bearing key or DB error',async mode=>{
 if(mode==='failure')db.query.mockRejectedValue(new Error(marker));else db.query.mockResolvedValue({rows:mode==='hit'?[{data:{pnl:123.45}}]:[]});
 expect(await Cache.get(marker,'analytics:'+marker)).toEqual(mode==='hit'?{pnl:123.45}:null);
 expect(db.query).toHaveBeenCalledWith(expect.any(String),[marker,'analytics:'+marker]);
 expect(Object.values(logger).flatMap(f=>f.mock.calls).map(a=>util.format(...a)).join('\n')).not.toContain(marker);
});
