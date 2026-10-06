jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioReconstructionService',()=>({
 historicalPrice:(series,date)=>series?.prices?.filter(p=>p.date<=date).at(-1)?.close||null,
 migrationPriceAliases:()=>new Map()
}));
const db=require('../src/config/database');
const {getHistoricalHoldings,remainingLots}=require('../src/services/portfolioHistoricalHoldings');
const range={start_date:'2024-01-01',end_date:'2024-02-01'};
const account={id:'a',account_identifier:'one',broker:'ibkr',currency:'USD'};
function fixture({trades=[],prices=[],reports=[],snapshots=[]}={}) {
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('portfolio_reconstruction_prices')?prices:
   sql.includes('broker_cash_reports')?reports:sql.includes('broker_import_snapshots')?snapshots:
   sql.includes('FROM trades')?trades:[]}));
}
beforeEach(()=>jest.clearAllMocks());
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
