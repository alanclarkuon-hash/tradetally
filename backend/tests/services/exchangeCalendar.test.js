jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('axios',()=>({get:jest.fn()}));
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
test('unknown listing metadata is fetched only when background lookup is allowed and then persisted/reused',async()=>{
 const db=require('../../src/config/database'),axios=require('axios');
 db.query.mockResolvedValue({rows:[]});
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'ETF',exchangeName:'PCX'}}]}}});
 expect(await calendar.resolve('ETF')).toBeNull(); expect(axios.get).not.toHaveBeenCalled();
 expect(await calendar.resolve('ETF',{allowLookup:true})).toBe('US');
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO exchange_calendar_listings'),['ETF','PCX']);
 expect(await calendar.resolve('ETF')).toBe('US'); expect(axios.get).toHaveBeenCalledTimes(1);
});
test('verified unsupported exchanges do not repeatedly request listing metadata',async()=>{
 const db=require('../../src/config/database'),axios=require('axios');
 db.query.mockResolvedValue({rows:[{exchange:'JPX',source:'yahoo'},{exchange:'NYSE',source:'classification'}]});
 const before=axios.get.mock.calls.length;
 expect(await calendar.resolve('UNSUPPORTED',{allowLookup:true})).toBeNull();
 expect(await calendar.resolve('UNSUPPORTED',{allowLookup:true})).toBeNull();
 expect(axios.get).toHaveBeenCalledTimes(before);
});

test.each(['2021-10-13','2021-10-14','2021-04-06','2023-07-17','2023-09-01','2023-09-08','2024-09-06','2026-04-07'])('HKEX full closure %s is not missing data',day=>{
 expect(missingRanges([],day,day,false,'HKEX')).toEqual([]);
});
test.each(['2021-02-11','2021-12-24','2021-12-31','2022-08-25','2022-11-02','2022-11-03','2024-10-01'])('HKEX partial sessions and another year holiday %s stay required',day=>{
 if(day==='2024-10-01')expect(calendar.isTradingDay(day,'US')).toBe(true);
 else expect(calendar.isTradingDay(day,'HKEX')).toBe(true);
});
test('Hong Kong identity works for suffix and verified exchange',async()=>{
 expect(await calendar.resolve('0700.HK')).toBe('HKEX');
 expect(calendar.identify('TENCENT','HKG')).toBe('HKEX');
 expect(missingRanges([],'2021-10-12','2021-10-15',false,'HKEX')).toEqual([{from:'2021-10-12',to:'2021-10-15'}]);
 expect(missingRanges([],'2021-10-13','2021-10-14',true,'HKEX')).toHaveLength(1);
});


test.each([['AAA.PA','EURONEXT'],['AAA.BR','EURONEXT'],['AAA.AS','EURONEXT'],['AAA.OL','OSLO'],['AAA.MI','MILAN'],['AAA.ST','STOCKHOLM'],['AAA.MC','MADRID']])('verified European suffix %s selects its own venue', (symbol,venue)=>expect(calendar.identify(symbol)).toBe(venue));
test.each([['PAR','EURONEXT'],['BRU','EURONEXT'],['OSL','OSLO'],['MIL','MILAN'],['STO','STOCKHOLM'],['MCE','MADRID']])('saved European exchange %s selects its own venue',(exchange,venue)=>expect(calendar.identify('NO_SUFFIX',exchange)).toBe(venue));
test('reviewed full closures are excluded but half days and other venues remain required',()=>{
 expect(missingRanges([],'2025-04-18','2025-04-21',false,'EURONEXT')).toEqual([]);
 expect(calendar.isTradingDay('2025-12-24','EURONEXT')).toBe(true);
 expect(calendar.isTradingDay('2025-12-24','MILAN')).toBe(false);
 expect(calendar.isTradingDay('2025-04-17','OSLO')).toBe(false);
 expect(calendar.isTradingDay('2025-04-16','OSLO')).toBe(true);
 expect(calendar.isTradingDay('2026-06-19','STOCKHOLM')).toBe(false);
 expect(calendar.isTradingDay('2026-04-02','STOCKHOLM')).toBe(true);
 expect(calendar.isTradingDay('2026-12-24','MADRID')).toBe(true);
 expect(calendar.isTradingDay('2023-01-02','EURONEXT')).toBe(true);
 expect(calendar.identify('UNKNOWN','UNVERIFIED OTC')).toBeNull();
});
test('calendar years outside published evidence keep weekday gaps and report incomplete calendar coverage',()=>{
 expect(calendar.coversRange('EURONEXT','2020-01-01','2026-12-31')).toBe(true);
 expect(calendar.coversRange('STOCKHOLM','2020-01-01','2026-12-31')).toBe(false);
 expect(calendar.isTradingDay('2023-01-06','STOCKHOLM')).toBe(true);
 expect(calendar.coversRange('MADRID','2026-01-01','2026-12-31')).toBe(true);
 expect(calendar.coversRange('OSLO','2020-01-01','2021-12-31')).toBe(false);
 expect(calendar.coversRange('EURONEXT','2027-01-01','2027-12-31')).toBe(false);
});


test('archived Madrid closures preserve actual half sessions and Milan daytime trading',()=>{
 expect(calendar.coversRange('MADRID','2021-01-01','2026-12-31')).toBe(true);
 for(const day of ['2021-12-24','2021-12-31','2022-04-18','2023-05-01','2024-12-26'])expect(calendar.isTradingDay(day,'MADRID')).toBe(false);
 for(const day of ['2024-12-24','2024-12-31','2025-12-24','2025-12-31','2022-05-02'])expect(calendar.isTradingDay(day,'MADRID')).toBe(true);
 expect(calendar.coversRange('MILAN','2022-01-01','2022-12-31')).toBe(true);
 expect(calendar.isTradingDay('2022-08-15','MILAN')).toBe(false);
 for(const day of ['2022-01-06','2022-06-02','2022-12-30'])expect(calendar.isTradingDay(day,'MILAN')).toBe(true);
 expect(calendar.coversRange('MILAN','2021-01-01','2022-12-31')).toBe(false);
});

 test.each(['OQX','OQB','PNK','OTCM','OTCQX','OTCQB','OTC Markets OTCQX','OTC Markets OTCQB','Pink Sheets'])('verified US OTC equity venue %s uses equity sessions',venue=>{
 expect(calendar.identify('SYNTHETIC',venue)).toBe('US');
 expect(calendar.identify('SYNTHETIC.L',venue)).toBe('LSE');
 });
 test('OTC holiday-only gaps disappear while early closes and genuine sessions remain required',()=>{
 const venue=calendar.identify('SYNTHETIC','OQX');
 for(const d of ['2024-12-25','2025-01-01','2025-01-09','2025-01-20','2025-02-17'])expect(missingRanges([],d,d,false,venue)).toEqual([]);
 for(const d of ['2025-01-10','2025-07-03','2025-11-28','2025-12-24','2025-10-13'])expect(missingRanges([],d,d,false,venue)).toEqual([{from:d,to:d}]);
 expect(missingRanges([],'2025-01-09','2025-01-10',false,venue)).toEqual([{from:'2025-01-10',to:'2025-01-10'}]);
 expect(calendar.identify('SYNTHETIC','OTC')).toBeNull();expect(calendar.identify('SYNTHETIC')).toBeNull();
 });
 test('previously persisted OTC listing resolves without fetching metadata again',async()=>{
 const db=require('../../src/config/database'),axios=require('axios');
 db.query.mockResolvedValue({rows:[{exchange:'OQX',source:'yahoo'}]});
 const before=axios.get.mock.calls.length;
 expect(await calendar.resolve('SYNTHETIC_OTC_CACHED',{allowLookup:true})).toBe('US');
 expect(await calendar.resolve('SYNTHETIC_OTC_CACHED')).toBe('US');
 expect(axios.get.mock.calls.length).toBe(before);
 });


test('broker namespace venue lookup persists evidence under original key without rewriting identities',async()=>{
 const db=require('../../src/config/database'),axios=require('axios');db.query.mockResolvedValue({rows:[]});
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'CALENDARSYNTH',currency:'USD',exchangeName:'NYQ'}}]}}});
 expect(await calendar.resolve('CALENDARSYNTH.US',{allowLookup:true})).toBe('US');
 expect(axios.get.mock.calls.at(-1)[0]).toContain('/CALENDARSYNTH');
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO exchange_calendar_listings'),['CALENDARSYNTH.US','NYQ']);
});
test('a namespace with conflicting venue is not saved or assigned a calendar',async()=>{
 const db=require('../../src/config/database'),axios=require('axios');db.query.mockResolvedValue({rows:[]});
 axios.get.mockResolvedValue({data:{chart:{result:[{meta:{symbol:'BADNAMESPACE',currency:'USD',exchangeName:'AMS'}}]}}});
 expect(await calendar.resolve('BADNAMESPACE.US',{allowLookup:true})).toBeNull();
 expect(db.query.mock.calls.some(([sql,params])=>sql.includes('INSERT INTO exchange_calendar_listings')&&params[0]==='BADNAMESPACE.US')).toBe(false);
});


test.each(['EXAMPLE.AX','EXAMPLE.ASX'])('Australian stock suffix %s uses ASX cash sessions',symbol=>expect(calendar.identify(symbol,'NYSE')).toBe('ASX'));
test.each(['ASX','XASX','Australian Securities Exchange'])('verified Australian venue %s uses cash sessions',exchange=>expect(calendar.identify('EXAMPLE',exchange)).toBe('ASX'));
test.each(['2022-01-03','2022-04-25','2022-09-22','2022-12-27','2023-06-12','2024-04-01','2025-01-27','2026-12-28','2027-12-27','2027-12-28'])('sourced ASX full closure %s is not missing history',d=>expect(missingRanges([],d,d,false,'ASX')).toEqual([]));
test.each(['2022-12-23','2022-12-30','2023-12-22','2023-12-29','2024-12-24','2024-12-31','2025-12-24','2025-12-31','2026-04-27','2027-04-26'])('ASX ordinary/shortened session %s still requires a candle',d=>expect(calendar.isTradingDay(d,'ASX')).toBe(true));
test('ASX exceptional closure does not hide another venue, crypto or adjacent missing session',()=>{
 expect(calendar.isTradingDay('2022-09-22','US')).toBe(true);
 expect(missingRanges([],'2022-09-22','2022-09-22',true,'ASX')).toHaveLength(1);
 expect(missingRanges([],'2022-09-22','2022-09-23',false,'ASX')).toEqual([{from:'2022-09-23',to:'2022-09-23'}]);
 expect(calendar.coversRange('ASX','2022-01-01','2027-12-31')).toBe(true);
 expect(calendar.coversRange('ASX','2021-01-01','2027-12-31')).toBe(false);
 expect(calendar.coversRange('ASX','2027-01-01','2028-12-31')).toBe(false);
 expect(calendar.isTradingDay('2021-01-26','ASX')).toBe(true);
 expect(calendar.identify('EXAMPLE','ASX24')).toBeNull();
});
