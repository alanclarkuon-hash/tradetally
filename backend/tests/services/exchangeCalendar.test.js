jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const calendar=require('../../src/services/exchangeCalendar');
const {missingRanges}=require('../../src/services/holdingsHistoryProvider');
test.each(['2025-04-18','2026-01-19','2025-01-09','2026-07-03','2022-06-20'])('US full closure %s does not need a candle',day=>{
 expect(missingRanges([],day,day,false,'US')).toEqual([]);
});
test.each(['2025-07-03','2025-11-28','2025-12-24','2021-12-31','2021-06-18','2026-10-12'])('US early closes and bank-only holidays %s still need a candle',day=>{
 expect(calendar.isTradingDay(day,'US')).toBe(true);
});
test('exchange-specific closures do not hide another market session or crypto history',()=>{
 expect(calendar.isTradingDay('2026-01-19','LSE')).toBe(true);
 expect(calendar.isTradingDay('2025-04-21','US')).toBe(true);
 expect(calendar.isTradingDay('2025-04-21','LSE')).toBe(false);
 expect(missingRanges([],'2025-04-18','2025-04-18',true,'US')).toEqual([{from:'2025-04-18',to:'2025-04-18'}]);
 expect(calendar.isTradingDay('2026-01-19',null)).toBe(true);
});
test.each(['2020-05-08','2021-12-27','2021-12-28','2022-06-02','2022-06-03','2022-09-19','2023-05-08'])('LSE observed/exceptional closure %s',day=>{
 expect(calendar.isTradingDay(day,'LSE')).toBe(false);
});
test('Xetra historical rules preserve trading on modern Whit Monday and German Unity Day',()=>{
 expect(calendar.isTradingDay('2021-05-24','XETRA')).toBe(false);
 expect(calendar.isTradingDay('2025-06-09','XETRA')).toBe(true);
 expect(calendar.isTradingDay('2025-10-03','XETRA')).toBe(true);
 expect(calendar.isTradingDay('2025-12-24','XETRA')).toBe(false);
});
test('recognized listing exchanges resolve but an ambiguous unsuffixed ticker never defaults to US',async()=>{
 expect(calendar.identify('MSFT','NASDAQ NMS - GLOBAL MARKET')).toBe('US');
 expect(calendar.identify('SPY','NYSEArca')).toBe('US');
 expect(calendar.identify('VWRL.L','NYSE')).toBe('LSE');
 expect(calendar.identify('RHM.DE')).toBe('XETRA');
 expect(calendar.identify('UNKNOWN')).toBeNull();
 const db=require('../../src/config/database'); db.query.mockResolvedValue({rows:[{exchange:'London'}]});
 expect(await calendar.resolve('LISTED')).toBe('LSE');
 expect(await calendar.resolve('LISTED')).toBe('LSE');
 expect(db.query).toHaveBeenCalledTimes(1);
});
test('a real missing session next to a holiday remains a gap',()=>{
 expect(missingRanges([],'2025-04-18','2025-04-21',false,'US')).toEqual([{from:'2025-04-21',to:'2025-04-21'}]);
});
