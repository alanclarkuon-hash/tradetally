const {datedDisplayRate,displayBasis}=require('../src/utils/heatmapCurrency');
test('dated FX uses the latest saved prior date, rejects stale/missing rates and never takes a future rate',()=>{
 const rate=datedDisplayRate([{rate_date:'2026-10-15',rates:{GBP:.7}},{rate_date:'2026-10-10',rates:{GBP:.8}}],'GBP');
 expect(rate('2026-10-09')).toBeNull();expect(rate('2026-10-14')).toBe(.8);expect(rate('2026-10-15')).toBe(.7);expect(rate('2026-10-23')).toBeNull();expect(rate('2026-10-14')).toBe(.8);
 expect(displayBasis([{date:'2026-10-14',amount:100},{date:'2026-10-15',amount:100}],rate)).toBe(150);
 expect(displayBasis([{date:'2026-10-09',amount:100}],rate)).toBeNull();
});
