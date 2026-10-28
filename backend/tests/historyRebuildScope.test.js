jest.mock('../src/services/stockAnalysisHistory',()=>({verified:jest.fn().mockRejectedValue(Error('Synthetic unavailable source'))}));
jest.mock('../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../src/services/portfolioDashboardService',()=>({FIAT:new Set(['USD','GBP']),STABLE:new Set(['USDT'])}));
jest.mock('../src/services/exchangeCalendar',()=>({resolve:jest.fn().mockResolvedValue('US'),isTradingDay:()=>true}));
const db=require('../src/config/database');
const svc=require('../src/services/portfolioReconstructionService');
const axios=require('axios');
let cash,network,shared;
beforeEach(()=>{
 jest.useFakeTimers().setSystemTime(new Date('2026-01-20T12:00:00Z'));
 cash=jest.spyOn(require('../src/services/brokerSync/igCashLedger'),'loadLedger').mockResolvedValue({openingBalance:100,rows:[],report:{to_date:'2026-01-19'}});
 network=jest.spyOn(axios,'get').mockRejectedValue(Error('Synthetic unavailable source'));
 shared=jest.spyOn(require('../src/services/portfolioService'),'_getDailySeries').mockResolvedValue([]);
 const account={id:'a',broker:'ig',account_identifier:'owned',initial_balance_date:'2025-01-01',currency:'USD'};
 const trades=[{symbol:'OLD',instrument_type:'stock',side:'long',entry_time:'2025-01-01',exit_time:'2025-02-01',quantity:1,entry_price:10},
 {symbol:'HELD',instrument_type:'stock',side:'long',entry_time:'2026-01-10',exit_time:'2026-01-13',quantity:1,entry_price:10}];
 db.query.mockImplementation(async(sql,args)=>({rows:sql.includes('user_accounts')?[account]:sql.includes('FROM trades')?trades:
 sql.includes('portfolio_reconstruction_prices')?[{payload:{currency:'USD',splits:[],prices:[{date:'2026-01-09',close:10},{date:'2026-01-12',close:12}]}}]:[]}));
 const client={query:jest.fn().mockResolvedValue({rows:[]})};db.withTransaction.mockImplementation(fn=>fn(client));
});
afterEach(()=>{cash.mockRestore();network.mockRestore();shared.mockRestore();jest.useRealTimers();});
test('recent reconstruction skips sold assets and only requests the held dates plus predecessor closes',async()=>{
 await svc.reconstruct('owner',{broker:'ig',fromDate:'2026-01-10',fetchPrices:true});
 const reads=db.query.mock.calls.filter(([q])=>q.includes('SELECT payload FROM portfolio_reconstruction_prices'));
 expect(reads.map(([,a])=>a[0])).toEqual(['HELD']);
 expect(shared.mock.calls.every(([,from,to])=>from>='2026-01-03'&&to<='2026-01-12')).toBe(true);
});



test('unavailable native ranges cool down, but changed evidence and expiry allow another attempt',async()=>{
 const call=()=>svc.loadMarket('RETRYTEST','2026-01-10','2026-01-12',{fetchPrices:true,userId:'owner',maintenance:true});
 await call();const first=network.mock.calls.length;expect(first).toBeGreaterThan(0);
 await call();expect(network).toHaveBeenCalledTimes(first);
 shared.mockResolvedValue([{time:Date.parse('2026-01-12')/1000,close:12}]);
 await call();expect(network.mock.calls.length).toBeGreaterThan(first);
 const changed=network.mock.calls.length;
 jest.setSystemTime(new Date('2026-01-20T19:00:00Z'));
 await call();expect(network.mock.calls.length).toBeGreaterThan(changed);
});


test('a later split remains in the metadata request for an already-closed holding range',async()=>{
 await svc.reconstruct('split-owner',{broker:'ig',fromDate:'2026-01-10',fetchPrices:true});
 const metadata=network.mock.calls.filter(([,o])=>o.params?.events==='splits');
 expect(metadata.length).toBeGreaterThan(0);
 expect(metadata.every(([,o])=>o.params.period2===Date.parse('2026-01-20')/1000)).toBe(true);
});

test('Trading 212 retains cached split replay while skipping a fully exited security',async()=>{
 const account={id:'a',broker:'trading212',account_identifier:'owned',initial_balance_date:'2026-01-01',currency:'USD'};
 const payload={currency:'USD',prices:[{date:'2026-01-01',close:10}],splits:[{date:'2026-01-05',ratio:2}]};
 const records=[{symbol:'TST',side:'BUY',date:'2026-01-01',quantity:10},{symbol:'TST',side:'SELL',date:'2026-01-10',quantity:20}];
 const ledger=jest.spyOn(require('../src/services/brokerSync/trading212CashLedger'),'loadLedger').mockResolvedValue({openingBalance:100,rows:[],report:{to_date:'2026-01-19'}});
 db.query.mockImplementation(async sql=>({rows:sql.includes('user_accounts')?[account]:sql.includes('broker_cash_reports')?[{records}]:sql.includes('SELECT symbol,payload FROM portfolio_reconstruction_prices')?[{symbol:'TST',payload}]:[]}));
 try {
  const result=await svc.reconstruct('owner',{broker:'trading212',fromDate:'2026-01-15',fetchPrices:true});
  expect(shared).not.toHaveBeenCalled();expect(network.mock.calls.filter(([url])=>url.includes('finance/chart'))).toHaveLength(0);
  expect(result[0].gaps).toBe(0);expect(result[0].issues).toEqual([]);
 } finally {ledger.mockRestore();}
});
