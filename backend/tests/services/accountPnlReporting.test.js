jest.mock('../../src/config/database',()=>({connect:jest.fn(),query:jest.fn()}));
jest.mock('../../src/services/analyticsCache',()=>({invalidate:jest.fn()}));
const db=require('../../src/config/database'),cache=require('../../src/services/analyticsCache');
const {refreshAccountResults}=require('../../src/services/accountPnlReporting');
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
