jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioReconstructionService',()=>({
 historicalPrice:(series,date)=>series?.prices?.filter(p=>p.date<=date).at(-1)?.close||null,
 migrationPriceAliases:()=>new Map()
}));
const db=require('../src/config/database');
const {getHistoricalHoldings,remainingLots}=require('../src/services/portfolioHistoricalHoldings');
const range={start_date:'2024-01-01',end_date:'2024-02-01'};
const account={id:'a',account_identifier:'one',broker:'ibkr',currency:'USD'};
function fixture({trades=[],prices=[],reports=[],snapshots=[],catalogues=[]}={}) {
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('broker_instrument_catalogues')?catalogues:sql.includes('portfolio_reconstruction_prices')?prices:
   sql.includes('broker_cash_reports')?reports:sql.includes('broker_import_snapshots')?snapshots:
   sql.includes('FROM trades')?trades:[]}));
}
beforeEach(()=>jest.clearAllMocks());
test('historical holdings prefer canonical completed shared prices over older reconstruction values',async()=>{
 fixture({trades:[{symbol:'HELD',entry_time:'2023-01-01',quantity:10,entry_price:5,instrument_type:'stock',side:'long',broker:'ibkr',account_identifier:'one'}],
  prices:[{symbol:'HELD',payload:{currency:'USD',prices:[{date:'2023-12-29',close:10},{date:range.end_date,close:12}]}}]});
 const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('FROM historical_prices')?Promise.resolve({rows:[{symbol:'HELD',price_date:'2023-12-29',close:11},{symbol:'HELD',price_date:range.end_date,close:15}]}):old(sql));
 const result=await getHistoricalHoldings('u',[account],range);expect(result.positions[0].periodResult).toMatchObject({basis:110,pnl:40});
});
test('historical heatmap uses a close strictly before the start and ignores the start-day candle',async()=>{
 fixture({trades:[{symbol:'HELD',entry_time:'2023-01-01',quantity:10,entry_price:5,instrument_type:'stock',side:'long',broker:'ibkr',account_identifier:'one'}],
  prices:[{symbol:'HELD',payload:{currency:'USD',prices:[{date:'2023-12-29',close:10},{date:range.start_date,close:11},{date:range.end_date,close:12}]}}]});
 const result=await getHistoricalHoldings('u',[account],range);
 expect(result.positions[0].periodResult).toEqual({pnl:20,percent:20,basis:100});
});
test('replays partial sales and splits without retaining sold or future units',()=>{
 const held=remainingLots([{date:'2023-01-01',symbol:'A',quantity:10,price:20},
  {date:'2023-02-01',symbol:'A',split:2},{date:'2023-03-01',symbol:'A',quantity:-5},
  {date:'2025-01-01',symbol:'A',quantity:100,price:2}],range.end_date).get('A');
 expect(held).toMatchObject([{quantity:15,price:10}]);
});
test('end-date holdings include later sales but exclude earlier sales and future purchases',async()=>{
 const trade=(symbol,entry,exit)=>({symbol,entry_time:entry,exit_time:exit,quantity:10,entry_price:5,instrument_type:'stock',side:'long',broker:'ibkr',account_identifier:'one'});
 fixture({trades:[trade('HELD','2023-01-01','2024-03-01'),trade('SOLD','2023-01-01','2024-01-31'),trade('FUTURE','2024-02-02'),trade('NEW','2024-01-15')],
  prices:['HELD','NEW'].map(symbol=>({symbol,payload:{currency:'USD',prices:[{date:'2023-12-29',close:10},{date:range.end_date,close:12}]}}))});
 const result=await getHistoricalHoldings('u',[account],range);
 expect(result.positions.map(p=>p.symbol)).toEqual(['HELD','NEW']);
 expect(result.positions[0]).toMatchObject({currentValue:120,periodResult:{pnl:20,percent:20,basis:100}});
 expect(result.positions[1]).toMatchObject({currentValue:120,periodResult:{pnl:70,basis:50}});
 expect(db.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});
test('missing historical prices use zero and never reuse current quotes or invent gains',async()=>{
 fixture({trades:[{symbol:'MISSING',entry_time:'2023-01-01',quantity:10,entry_price:5,instrument_type:'stock',side:'long',broker:'ibkr',account_identifier:'one'}]});
 const result=await getHistoricalHoldings('u',[account],range);
 expect(result.positions[0]).toMatchObject({currentValue:0,periodResult:{pnl:null,percent:null}});
 expect(result.positions[0].historicalWarnings).toContain('Missing historical price; value estimated at zero');
});
test('Trading 212 closed holdings come from historical orders and retain only remaining lots',async()=>{
 fixture({reports:[{account_id:'a',broker_type:'trading212',records:[
  {symbol:'ABC_US_EQ',side:'BUY',date:'2023-01-01',quantity:10,amount:-50},
  {symbol:'ABC_US_EQ',side:'SELL',date:'2024-01-15',quantity:4,amount:40},
  {symbol:'ABC_US_EQ',side:'SELL',date:'2024-03-01',quantity:6,amount:60}]}],
  prices:[{symbol:'ABC',payload:{currency:'USD',prices:[{date:'2023-12-29',close:10},{date:range.end_date,close:12}]}}]});
 const result=await getHistoricalHoldings('u',[{...account,broker:'trading212'}],range);
 expect(result.positions).toHaveLength(1);
 expect(result.positions[0]).toMatchObject({symbol:'ABC',totalShares:6,currentValue:72,periodResult:{pnl:12,basis:60}});
});
test('Kraken spot and Earn wallets are counted once and selected accounts stay isolated',async()=>{
 const time=d=>Date.parse(d)/1000;
 fixture({snapshots:[{broker_type:'kraken',account_identifier:'one',payload:{ledger:{
  deposit:{asset:'XBT',amount:'2',fee:'0',time:time('2023-01-01')},
  out:{asset:'XBT',amount:'-1',fee:'0',time:time('2024-01-15')},
  earn:{asset:'XBT.F',amount:'1',fee:'0',time:time('2024-01-15')},
  future:{asset:'ETH',amount:'10',fee:'0',time:time('2024-03-01')}},
  valuation:{rates:{BTC:{'2023-12-31':10,'2024-02-01':12}}}}}],
  trades:[{account_identifier:'other',broker:'kraken',symbol:'BTC',quantity:100,entry_time:'2023-01-01'}]});
 const result=await getHistoricalHoldings('u',[{...account,broker:'kraken'}],range);
 expect(result.positions).toHaveLength(1);
 expect(result.positions[0]).toMatchObject({symbol:'BTC',totalShares:2,currentValue:24,periodResult:{pnl:4,basis:20}});
});

test('historical EUR display conversion uses EUR instead of GBP',async()=>{
 fixture();const original=db.query.getMockImplementation();
 db.query.mockImplementation(sql=>sql.includes('fx_daily_rates')?Promise.resolve({rows:[{rate_date:range.end_date,rates:{EUR:.9,GBP:.8}}]}):original(sql));
 const result=await getHistoricalHoldings('synthetic',[account],range,'EUR');
 expect(result.displayRates.USD).toBeCloseTo(.9);
});

test('closed Trading 212 instruments use saved catalogue identity without current holdings or broker requests',async()=>{fixture({catalogues:[{instruments:[{ticker:'LOKB_US_EQ',shortName:'NVTS',isin:'US63942X1063'}]}],reports:[{account_id:'a',broker_type:'trading212',records:[{symbol:'LOKB_US_EQ',side:'BUY',date:'2023-01-01',quantity:10,amount:-50},{symbol:'LOKB_US_EQ',side:'SELL',date:'2024-03-01',quantity:10,amount:100}]}],prices:[{symbol:'NVTS',payload:{currency:'USD',prices:[{date:'2023-12-29',close:10},{date:range.end_date,close:12}]}}]});const r=await getHistoricalHoldings('owner',[{...account,broker:'trading212'}],range);expect(r.positions).toHaveLength(1);expect(r.positions[0]).toMatchObject({symbol:'NVTS',totalShares:10,currentValue:120,periodResult:{pnl:20,basis:100}});expect(db.query).toHaveBeenCalledWith(expect.stringContaining('broker_instrument_catalogues'),['owner','one']);expect(db.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true)});


test('combined account holdings never treat a partial period basis as complete',async()=>{
 const accounts=[{...account,broker:'kraken'},{...account,id:'b',account_identifier:'two',broker:'kraken'}];
 fixture({snapshots:accounts.map((a,i)=>({broker_type:'kraken',account_identifier:a.account_identifier,payload:{ledger:{deposit:{asset:'XBT',amount:'2',fee:'0',time:Date.parse(i?'2024-01-15':'2023-01-01')/1000}},valuation:{rates:{BTC:{'2023-12-31':10,'2024-02-01':12}}}}}))});
 const result=await getHistoricalHoldings('u',accounts,range);
 expect(result.positions[0]).toMatchObject({totalShares:4,currentValue:48,periodResult:{basis:null,pnl:null,percent:null}});
 const {currentRangeResult}=require('../src/services/portfolioDashboardService');
 expect(currentRangeResult({instrumentType:'crypto',totalShares:4,currentValue:52},range,result.positions[0])).toEqual({pnl:null,percent:null});
});

test('combined complete bases remain usable with a current quote when historical ending prices are missing',async()=>{
 const accounts=[account,{...account,id:'b',account_identifier:'two'}];
 fixture({trades:accounts.map(a=>({symbol:'HELD',entry_time:'2023-01-01',quantity:10,entry_price:5,instrument_type:'stock',side:'long',broker:'ibkr',account_identifier:a.account_identifier})),prices:[{symbol:'HELD',payload:{currency:'USD',prices:[{date:'2023-12-29',close:10}]}}]});
 const result=await getHistoricalHoldings('u',accounts,range);
 expect(result.positions[0].periodResult).toEqual({basis:200,pnl:null,percent:null});
 const {currentRangeResult}=require('../src/services/portfolioDashboardService');
 expect(currentRangeResult({instrumentType:'stock',totalShares:20,currentValue:240},range,result.positions[0])).toEqual({pnl:40,percent:20,basis:200});
});


test('historical holdings reject both legacy native and canonical Skycoin caches',async()=>{const r={start_date:'2025-01-01',end_date:'2025-01-03'};fixture({trades:[{symbol:'SKY',entry_time:'2024-12-01',quantity:10,entry_price:.05,instrument_type:'crypto',side:'long',broker:'ibkr',account_identifier:'one'}],prices:[{symbol:'SKY-USD',payload:{currency:'USD',prices:[{date:r.end_date,close:.2}]}}]});const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('FROM historical_prices')?Promise.resolve({rows:[{symbol:'crypto:SKY',price_date:r.end_date,close:.2}]}):old(sql));const result=await getHistoricalHoldings('u',[account],r);expect(result.positions[0]).toMatchObject({currentValue:0,periodResult:{pnl:null}})});
test('historical holdings read the bound protocol price and prefer its canonical close',async()=>{const r={start_date:'2025-01-01',end_date:'2025-01-03'};fixture({trades:[{symbol:'SKY',entry_time:'2024-12-01',quantity:10,entry_price:.05,instrument_type:'crypto',side:'long',broker:'ibkr',account_identifier:'one'}],prices:[{symbol:'SKY-USD',payload:{currency:'USD',prices:[{date:r.end_date,close:100}]}},{symbol:'SKY@sky-USD',payload:{currency:'USD',cryptoIdentity:require('../src/services/cryptoHistoryIdentity').evidence('SKY'),prices:[{date:'2024-12-31',close:.06},{date:r.end_date,close:.08}]}}]});const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('FROM historical_prices')?Promise.resolve({rows:[{symbol:'crypto:SKY',price_date:r.end_date,close:100},{symbol:'crypto:SKY:sky',price_date:r.end_date,close:.09}]}):old(sql));const result=await getHistoricalHoldings('u',[account],r);expect(result.positions[0].currentValue).toBeCloseTo(.9);expect(result.positions[0].periodResult.pnl).toBeCloseTo(.3)});
test('pre-SKY closed eToro Maker lot is displayed in original MKR units',async()=>{const r={start_date:'2023-01-01',end_date:'2023-01-03'};fixture({trades:[{symbol:'SKY',entry_time:'2022-01-01',exit_time:'2024-02-01',quantity:2,entry_price:2000,instrument_type:'crypto',side:'long',broker:'etoro',account_identifier:'one',executions:[{type:'entry',etoro_source_type:'Crypto',etoro_statement_symbol:'SKY',etoro_native_price:2000}]}],prices:[{symbol:'MKR-USD',payload:{currency:'USD',prices:[{date:'2022-12-31',close:2000},{date:r.end_date,close:2100}]}},{symbol:'SKY-USD',payload:{currency:'USD',prices:[{date:r.end_date,close:.2}]}}]});const result=await getHistoricalHoldings('u',[{...account,broker:'etoro'}],r);expect(result.positions[0]).toMatchObject({symbol:'MKR',totalShares:2,currentValue:4200});});


test.each(['ibkr','etoro','ig'])('dated display basis for %s stock lots preserves acquisitions and partial sales',async broker=>{
 const r={start_date:'2026-10-14',end_date:'2026-10-15'};
 fixture({trades:[{symbol:'DEMO',entry_time:'2025-01-01',quantity:2,entry_price:5,instrument_type:'stock',side:'long',broker,account_identifier:'one'},
 {symbol:'DEMO',entry_time:'2026-10-15',quantity:1,entry_price:11,instrument_type:'stock',side:'long',broker,account_identifier:'one'}],
 prices:[{symbol:'DEMO',payload:{currency:'USD',prices:[{date:'2026-10-13',close:10},{date:r.end_date,close:12}]}}]});
 const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('fx_daily_rates')?Promise.resolve({rows:[{rate_date:'2026-10-13',rates:{GBP:.8,EUR:.9}},{rate_date:r.end_date,rates:{GBP:.7,EUR:1}}]}):old(sql));
 const gbp=await getHistoricalHoldings('u',[{...account,broker}],r,'GBP');
 expect(gbp.positions[0].periodResult.displayBasis).toBeCloseTo(23.7);
 const eur=await getHistoricalHoldings('u',[{...account,broker}],r,'EUR');expect(eur.positions[0].periodResult.displayBasis).toBe(29);
});
test('Trading 212 GBP acquisition uses actual account amount once and each basis date has its own FX',async()=>{
 const r={start_date:'2026-10-14',end_date:'2026-10-15'};
 fixture({reports:[{account_id:'a',broker_type:'trading212',records:[{symbol:'DEMO_US_EQ',side:'BUY',date:'2026-10-01',quantity:10,amount:-50},{symbol:'DEMO_US_EQ',side:'SELL',date:'2026-10-14',quantity:4,amount:40},{symbol:'DEMO_US_EQ',side:'BUY',date:r.end_date,quantity:2,amount:-20}]}],prices:[{symbol:'DEMO',payload:{currency:'USD',prices:[{date:'2026-10-13',close:10},{date:r.end_date,close:12}]}}]});
 const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('fx_daily_rates')?Promise.resolve({rows:[{rate_date:'2026-10-01',rates:{GBP:.75}},{rate_date:'2026-10-13',rates:{GBP:.8}},{rate_date:r.end_date,rates:{GBP:.7}}]}):old(sql));
 const result=await getHistoricalHoldings('u',[{...account,broker:'trading212',currency:'GBP'}],r,'GBP');
 expect(result.positions[0]).toMatchObject({totalShares:8,periodResult:{displayBasis:68}});
});
test.each(['kraken','okx'])('%s crypto opening basis uses calendar days including Sunday',async broker=>{
 const r={start_date:'2026-10-05',end_date:'2026-10-06'},time=Date.parse('2026-09-01');
 const payload=broker==='kraken'?{ledger:{deposit:{asset:'XBT',amount:'2',fee:'0',time:time/1000}}}:{bills:[{ccy:'BTC',balChg:'2',ts:String(time)}]};
 fixture({snapshots:[{broker_type:broker,account_identifier:'one',payload}],prices:[{symbol:'BTC-USD',payload:{currency:'USD',prices:[{date:'2026-10-04',close:100},{date:r.end_date,close:110}]}}]});
 const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('fx_daily_rates')?Promise.resolve({rows:[{rate_date:'2026-10-04',rates:{GBP:.8}},{rate_date:r.end_date,rates:{GBP:.7}}]}):old(sql));
 const result=await getHistoricalHoldings('u',[{...account,broker}],r,'GBP');expect(result.positions[0].periodResult.displayBasis).toBe(160);
});
test('missing opening FX never silently uses current FX for a foreign-currency return',async()=>{
 fixture({trades:[{symbol:'HELD',entry_time:'2023-01-01',quantity:10,entry_price:5,instrument_type:'stock',side:'long',broker:'ibkr',account_identifier:'one'}],prices:[{symbol:'HELD',payload:{currency:'USD',prices:[{date:'2023-12-29',close:10},{date:range.end_date,close:12}]}}]});
 const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('fx_daily_rates')?Promise.resolve({rows:[{rate_date:range.end_date,rates:{GBP:.8}}]}):old(sql));
 const result=await getHistoricalHoldings('u',[account],range,'GBP');expect(result.positions[0].periodResult).toMatchObject({basis:100,displayBasis:null});
});


test('leveraged eToro CFD return converts collateral equity, never underlying notional',async()=>{
 const r={start_date:'2026-10-15',end_date:'2026-10-15'};
 fixture({trades:[{symbol:'DEMO',entry_time:'2026-10-01',quantity:2,entry_price:100,instrument_type:'cfd',side:'long',broker:'etoro',account_identifier:'one',executions:[{type:'entry',etoro_leverage:2,etoro_native_price:100}]}],prices:[{symbol:'DEMO',payload:{currency:'USD',prices:[{date:'2026-10-14',close:100},{date:r.end_date,close:110}]}}]});
 const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('fx_daily_rates')?Promise.resolve({rows:[{rate_date:'2026-10-14',rates:{GBP:.8}},{rate_date:r.end_date,rates:{GBP:.7}}]}):old(sql));
 const result=await getHistoricalHoldings('u',[{...account,broker:'etoro'}],r,'GBP');
 expect(result.positions[0]).toMatchObject({currentValue:120,periodResult:{basis:100,displayBasis:80}});
});
test('same asset in multiple accounts sums dated converted bases and keeps missing FX incomplete',async()=>{
 const r={start_date:'2026-10-15',end_date:'2026-10-15'},accounts=[account,{...account,id:'b',account_identifier:'two'}];
 fixture({trades:accounts.map((a,i)=>({symbol:'DEMO',entry_time:i?'2026-10-15':'2026-10-01',quantity:2,entry_price:100,instrument_type:'stock',side:'long',broker:'ibkr',account_identifier:a.account_identifier})),prices:[{symbol:'DEMO',payload:{currency:'USD',prices:[{date:'2026-10-14',close:100},{date:r.end_date,close:110}]}}]});
 const old=db.query.getMockImplementation();let missing=false;db.query.mockImplementation(sql=>sql.includes('fx_daily_rates')?Promise.resolve({rows:[...(!missing?[{rate_date:'2026-10-14',rates:{GBP:.8}}]:[]),{rate_date:r.end_date,rates:{GBP:.7}}]}):old(sql));
 const result=await getHistoricalHoldings('u',accounts,r,'GBP');expect(result.positions[0].periodResult.displayBasis).toBe(300);
 missing=true;const partial=await getHistoricalHoldings('u',accounts,r,'GBP');expect(partial.positions[0].periodResult.displayBasis).toBeNull();
});

// Synthetic CFD fixtures: current account value is collateral plus broker P&L.
function cfdFixture({side='long',currency='USD',prices=[],shared=[],fxRows=[],quantity=2,entryPrice=100,nativeEntry=100,splits=[]}={}) {
 const r={start_date:'2026-10-15',end_date:'2026-10-15'};
 fixture({trades:[{symbol:'DEMO',entry_time:'2026-10-01',quantity,entry_price:entryPrice,instrument_type:'cfd',side,broker:'etoro',account_identifier:'one',executions:[{type:'entry',etoro_leverage:2,etoro_native_price:nativeEntry}]}],prices:[{symbol:'DEMO',payload:{currency,prices,splits}}]});
 const old=db.query.getMockImplementation();db.query.mockImplementation(sql=>sql.includes('FROM historical_prices')?Promise.resolve({rows:shared.map(p=>({symbol:'DEMO',price_date:p.date,close:p.close}))}):sql.includes('fx_daily_rates')?Promise.resolve({rows:fxRows}):old(sql));
 return r;
}
test.each(['long','short'])('CFD %s opening equity prefers the verified exact-session USD close over a stale native cache',async side=>{
 const r=cfdFixture({side,prices:[{date:'2026-10-13',close:110},{date:rEnd(),close:105}],shared:[{date:'2026-10-14',close:100},{date:rEnd(),close:105}]});
 const result=await getHistoricalHoldings('u',[{...account,broker:'etoro'}],r);
 expect(result.positions[0]).toMatchObject({currentValue:side==='long'?110:90,periodResult:{basis:100,pnl:side==='long'?10:-10}});
});
function rEnd(){return '2026-10-15'}
test('CFD missing prior-session close stays unavailable rather than carrying an older trading day forward',async()=>{
 const r=cfdFixture({prices:[{date:'2026-10-13',close:110},{date:rEnd(),close:105}]});
 const result=await getHistoricalHoldings('u',[{...account,broker:'etoro'}],r);
 expect(result.positions[0].periodResult).toMatchObject({basis:null,pnl:null,percent:null});
});
test('foreign CFD canonical USD closes undo close-date FX once before native P&L conversion',async()=>{
 const r=cfdFixture({currency:'EUR',entryPrice:125,nativeEntry:100,prices:[{date:'2026-10-13',close:110}],shared:[{date:'2026-10-14',close:125},{date:rEnd(),close:132}],fxRows:[{rate_date:'2026-10-14',rates:{EUR:.8,GBP:.8}},{rate_date:rEnd(),rates:{EUR:5/6,GBP:.7}}]});
 const result=await getHistoricalHoldings('u',[{...account,broker:'etoro'}],r,'GBP');
 // 125 USD collateral; native close 100 -> 110 EUR, 20 EUR P&L -> 24 USD.
 expect(result.positions[0]).toMatchObject({currentValue:149,periodResult:{basis:125,displayBasis:100}});
});
test('CFD Monday opening equity uses Friday close and Friday display FX, with no weekend candle needed',async()=>{
 const r=cfdFixture({prices:[],shared:[{date:'2026-10-09',close:100},{date:'2026-10-12',close:105}],fxRows:[{rate_date:'2026-10-09',rates:{GBP:.8}},{rate_date:'2026-10-12',rates:{GBP:.7}}]});
 const result=await getHistoricalHoldings('u',[{...account,broker:'etoro'}],{...r,start_date:'2026-10-12',end_date:'2026-10-12'},'GBP');
 expect(result.positions[0]).toMatchObject({currentValue:110,periodResult:{basis:100,displayBasis:80}});
});
