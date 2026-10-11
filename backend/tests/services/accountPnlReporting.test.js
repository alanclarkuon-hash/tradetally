jest.mock('../../src/config/database',()=>({connect:jest.fn(),query:jest.fn()}));
jest.mock('../../src/services/analyticsCache',()=>({invalidate:jest.fn()}));
const db=require('../../src/config/database'),cache=require('../../src/services/analyticsCache');
const {refreshAccountResults,reportAccountPnl}=require('../../src/services/accountPnlReporting');
jest.mock('../../src/utils/tradeFx',()=>({...jest.requireActual('../../src/utils/tradeFx'),getUsdRateMap:jest.fn()}));
beforeEach(()=>jest.clearAllMocks());
test('refresh writes only rebuildable reporting cache and invalidates analytics',async()=>{
 const queries=[];const query=jest.fn(async(sql)=>{queries.push(sql);return {rows:sql.includes('SELECT t.*')?[{id:'synthetic',configured_account_currency:'USD',source_signature:'signature',original_currency:'USD',entry_price:100,quantity:1,side:'long',pnl:5,commission:0,fees:0,exit_time:'2026-01-02T00:00:00Z',executions:[]}]:[]}});
 const release=jest.fn();db.connect.mockResolvedValue({query,release});await refreshAccountResults('owner');
 expect(queries.some(sql=>sql.startsWith('INSERT INTO trade_account_reports'))).toBe(true);
 expect(queries.some(sql=>/^UPDATE trades|^INSERT INTO trades|^DELETE FROM trades/.test(sql))).toBe(false);
 expect(cache.invalidate).toHaveBeenCalledWith('owner');expect(release).toHaveBeenCalled();
});
test('unchanged sources perform no projection writes or cache invalidation',async()=>{
 const query=jest.fn().mockResolvedValue({rows:[]});db.connect.mockResolvedValue({query,release:jest.fn()});expect(await refreshAccountResults('owner')).toBe(0);expect(cache.invalidate).not.toHaveBeenCalled();
});
test('rollback and release on calculation cache failure',async()=>{
 const query=jest.fn(async(sql)=>{if(sql.includes('SELECT t.*'))throw Error('query failed');return {rows:[]}}),release=jest.fn();db.connect.mockResolvedValue({query,release});await expect(refreshAccountResults('owner')).rejects.toThrow('query failed');expect(query).toHaveBeenCalledWith('ROLLBACK');expect(release).toHaveBeenCalled();
});

test('FX snapshot changes invalidate all reporting caches, while unchanged FX reuses them',async()=>{
 const fx=require('../../src/utils/tradeFx');db.connect.mockResolvedValue({query:jest.fn().mockResolvedValue({rows:[]}),release:jest.fn()});db.query.mockResolvedValue({rows:[]});
 const invoke=async()=>{const req={user:{id:'fx-owner'}};await new Promise((resolve,reject)=>reportAccountPnl(req,{},error=>error?reject(error):resolve()));return req.accountFxKey;};
 fx.getUsdRateMap.mockResolvedValue({USD:1,GBP:.8});const first=await invoke();expect(cache.invalidate).toHaveBeenCalledTimes(1);await invoke();expect(cache.invalidate).toHaveBeenCalledTimes(1);
 fx.getUsdRateMap.mockResolvedValue({USD:1,GBP:.7});expect(await invoke()).not.toBe(first);expect(cache.invalidate).toHaveBeenCalledTimes(2);
});
