jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/exchangeCalendar',()=>({...jest.requireActual('../src/services/exchangeCalendar'),resolve:jest.fn()}));
const db=require('../src/config/database'),calendar=require('../src/services/exchangeCalendar');
const {readPreviousClose}=require('../src/services/assetPreviousClose');
const now=new Date('2026-10-15T12:00:00Z');
function fixture(row={close:'8',price_currency:'USD',is_final:true,data_source:'stockanalysis:twelve',saved_at:'2026-10-15T10:00:00Z'}){
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('FROM historical_prices')?(row?[row]:[]):sql.includes('portfolio_reconstruction_prices')?[{payload:{currency:'GBP'}}]:sql.includes('fx_daily_rates')?[{rate_date:'2026-10-14',rates:{GBP:.75}}]:[]}));
}
beforeEach(()=>{jest.resetAllMocks();calendar.resolve.mockResolvedValue('LSE');fixture();});
test('reads the exact finalized session, keeps source/save time and converts once with dated FX',async()=>{
 const p=await readPreviousClose('EXAMPLE.L','stock',{now});expect(p).toMatchObject({status:'available',sessionDate:'2026-10-14',amount:8,currency:'USD',source:'stockanalysis:twelve',savedAt:'2026-10-15T10:00:00Z',marketTimestamp:null,nativeEquivalent:{amount:6,currency:'GBP',usdRate:.75,fxDate:'2026-10-14'}});
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE symbol=$1 AND price_date=$2'),['EXAMPLE.L','2026-10-14']);expect(db.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});
test('London Easter closures select Thursday, without replacing a missing close with an older one',async()=>{
 fixture(null);const p=await readPreviousClose('EXAMPLE.L','stock',{now:new Date('2026-04-07T12:00:00Z')});expect(p).toEqual({status:'missing',sessionDate:'2026-04-02'});
});
test.each([['BTC','crypto:BTC'],['SKY','crypto:SKY:sky']])('crypto %s uses its bound identity and calendar-day close',async(symbol,key)=>{
 await readPreviousClose(symbol,'crypto',{now:new Date('2026-10-05T12:00:00Z')});expect(calendar.resolve).not.toHaveBeenCalled();expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM historical_prices'),[key,'2026-10-04']);
});
test.each([[{close:8,is_final:false,price_currency:'USD'},'provisional'],[{close:8,is_final:true,price_currency:null},'unverified_currency'],[{close:8,is_final:true,price_currency:'USD',data_source:'coingecko'},'identity_unverified']])('does not present unverified evidence as a closing price',async(row,status)=>{
 fixture(row);expect((await readPreviousClose('EXAMPLE.L','stock',{now})).status).toBe(status);
});
test('unknown exchange or missing dated FX stays unavailable without provider calls',async()=>{
 calendar.resolve.mockResolvedValue(null);expect(await readPreviousClose('EXAMPLE','stock',{now})).toEqual({status:'calendar_unavailable',sessionDate:null});expect(db.query).not.toHaveBeenCalled();
 calendar.resolve.mockResolvedValue('LSE');const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('fx_daily_rates')?Promise.resolve({rows:[]}):old(sql));expect((await readPreviousClose('EXAMPLE.L','stock',{now})).nativeEquivalent).toBeNull();
});
test('previous day follows the user timezone at UTC midnight',async()=>{
 await readPreviousClose('BTC','crypto',{now:new Date('2026-10-15T23:30:00Z'),timeZone:'Europe/London'});expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM historical_prices'),['crypto:BTC','2026-10-15']);
});
