const {buildTradeDateRangeClause}=require('../../src/utils/tradeDateFilter');
test('original settlements use broker event dates and retain paired date fallback for other records',()=>{
 const r=buildTradeDateRangeClause({startDate:'2026-01-01',endDate:'2026-12-31'},2);
 expect(r.params).toEqual(['2026-01-01','2026-12-31']);expect(r.clause).toContain("ar.result->>'basis'='original_broker_execution'");
 expect(r.clause).toContain("(event->>'time')::timestamptz::date >= $2");expect(r.clause).toContain("(event->>'time')::timestamptz::date <= $3");
 expect(r.clause).toContain('ELSE ((t.trade_date >= $2');expect(r.clause).toContain('t.exit_time::date');
});
test('single-ended ranges preserve parameter binding and alias',()=>{
 for(const field of ['startDate','endDate']){const r=buildTradeDateRangeClause({[field]:'2026-01-01'},4,'source');expect(r.params).toEqual(['2026-01-01']);expect(r.clause).toContain('ar.trade_id=source.id');expect(r.clause).not.toContain('$5');}
});
test('no date filter adds no reporting lookup',()=>{expect(buildTradeDateRangeClause({},2)).toEqual({clause:'',params:[]})});
