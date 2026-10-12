jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioDashboardService',()=>({FIAT:new Set(['USD','GBP']),STABLE:new Set(['USDT'])}));
jest.mock('../src/utils/quoteCurrency',()=>({normaliseMinorUnit:c=>c==='GBp'?{code:'GBP',divisor:100}:c?{code:c,divisor:1}:null}));
const {walletHistory,valueQuantities,parseYahoo,historicalPrice,replayShares}=require('../src/services/portfolioReconstructionService');
test('migration price aliases require recorded unique 1:1 conversions and apply only on arrival day',()=>{
 const {migrationPriceAliases}=require('../src/services/portfolioReconstructionService');
 const time=Date.parse('2025-07-22')/1000;
 const ledger={old:{asset:'EOS',type:'transfer',amount:'-10',time},next:{asset:'A',type:'transfer',amount:'10',time:time+3600}};
 expect([...migrationPriceAliases(ledger)]).toEqual([['A:2025-07-22','EOS']]);
 expect(migrationPriceAliases({...ledger,next:{...ledger.next,amount:'9'}}).size).toBe(0);
 expect(migrationPriceAliases({...ledger,duplicate:{...ledger.next}}).size).toBe(0);
 expect(migrationPriceAliases({...ledger,old:{...ledger.old,subtype:'spottostaking'}}).size).toBe(0);
});
test('native ledger replay preserves fees, tiny rewards and non-additive Earn transfers',()=>{
 const events=[{wallet:'XXBT',time:Date.parse('2025-01-01'),amount:'1',fee:'0.01'},
  {wallet:'XXBT',time:Date.parse('2025-01-02'),amount:'-0.5',fee:'0'},
  {wallet:'XXBT.S',time:Date.parse('2025-01-02'),amount:'0.5',fee:'0'},
  {wallet:'XXBT.S',time:Date.parse('2025-01-03'),amount:'0.00000001',fee:'0'}];
 const rows=walletHistory(events,'2025-01-01','2025-01-03');
 expect(rows[0].quantities.BTC).toBeCloseTo(.99,10);
 expect(rows[1].quantities.BTC).toBeCloseTo(.99,10);
 expect(rows[2].quantities.BTC).toBeCloseTo(.99000001,10);
});
test('stablecoins and fiat cash are separate; missing prices invalidate the whole account day',()=>{
 const result=valueQuantities({BTC:2,USDT:10,GBP:20},'2025-01-01',s=>s==='BTC'?100:1,s=>s==='GBP'?1.25:1);
 expect(result).toMatchObject({holdings_usd:200,cash_usd:25,stablecoins_usd:10,issues:[]});
 expect(valueQuantities({BTC:1,MISSING:2},'2025-01-01',()=>null,()=>1).holdings_usd).toBeNull();
 expect(valueQuantities({BTC:-1},'2025-01-01',()=>100,()=>1).holdings_usd).toBeNull();
});
test('explicit zero-price mode keeps known values and records estimates without zeroing invalid cash or quantities',()=>{
 const value=valueQuantities({BTC:2,MISSING:3,GBP:20},'2025-01-01',s=>s==='BTC'?100:null,()=>1.25,{zeroMissingPrices:true});
 expect(value).toMatchObject({holdings_usd:200,cash_usd:25,stablecoins_usd:0,
 issues:['Estimated at zero: missing historical price for MISSING']});
 expect(valueQuantities({BTC:-1},'2025-01-01',()=>100,()=>1,{zeroMissingPrices:true}).holdings_usd).toBeNull();
 expect(valueQuantities({GBP:20},'2025-01-01',()=>100,()=>null,{zeroMissingPrices:true}).cash_usd).toBeNull();
});
test('dated exchange closes cover a weekend but never a long price outage or a crypto missing day',()=>{
 const series={prices:[{date:'2025-01-03',close:10}]};
 expect(historicalPrice(series,'2025-01-05')).toBe(10);
 expect(historicalPrice(series,'2025-01-12')).toBeNull();
 expect(historicalPrice(series,'2025-01-04',true)).toBeNull();
});
test('unadjusts split-normalized prices and pence without introducing dividend total returns',()=>{
 const series=parseYahoo({meta:{currency:'GBp'},timestamp:[Date.parse('2025-01-01')/1000,Date.parse('2025-01-03')/1000],
  indicators:{quote:[{close:[500,600]}],adjclose:[{adjclose:[400,500]}]},events:{splits:{s:{date:Date.parse('2025-01-02')/1000,numerator:2,denominator:1}}}});
 expect(series.currency).toBe('GBP');expect(series.prices.map(p=>p.close)).toEqual([10,6]);
 expect(()=>parseYahoo({meta:{},timestamp:[]})).toThrow('currency');
});
test('replays quantities on split dates and keeps a buy/sell pair from becoming repeated holdings',()=>{
 const rows=replayShares([{date:'2025-01-01',symbol:'TEST',quantity:3},{date:'2025-01-02',symbol:'TEST',quantity:-2}],
  [{date:'2025-01-02',symbol:'TEST',ratio:2}],'2025-01-01','2025-01-03');
 expect(rows.map(r=>r.quantities.TEST)).toEqual([3,4,4]);
});


test('bounded recovery keeps older history and does not rebuild another account',async()=>{
 jest.useFakeTimers().setSystemTime(new Date('2026-01-06T12:00:00Z'));
 const db=require('../src/config/database');
 const accounts=[{id:'a',broker:'ibkr',account_identifier:'owned',initial_balance_date:'2026-01-01'},
  {id:'b',broker:'ibkr',account_identifier:'other',initial_balance_date:'2026-01-01'}];
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('user_accounts')?accounts:sql.includes('fx_daily_rates')?[{rate_date:'2026-01-04',rates:{GBP:.8}}]:[]}));
 const client={query:jest.fn().mockResolvedValue({rows:[]})};
 db.withTransaction=jest.fn(fn=>fn(client));
 try{
  const result=await require('../src/services/portfolioReconstructionService').reconstruct('owner',{broker:'ibkr',accountIdentifiers:['owned'],fromDate:'2026-01-04',apply:true});
  expect(result).toHaveLength(1);
  expect(client.query.mock.calls[0]).toEqual([expect.stringContaining('value_date >= $3'),['owner','owned','2026-01-04']]);
  expect(client.query.mock.calls.slice(1).map(([,args])=>args[2])).toEqual(['2026-01-04','2026-01-05']);
  expect(client.query.mock.calls.every(([,args])=>args[1]==='owned')).toBe(true);
 }finally{jest.useRealTimers();}
});

test('reconstruction requests current ticker history for a closed broker asset with original keys preserved',async()=>{jest.useFakeTimers().setSystemTime(new Date('2026-01-06T12:00:00Z'));const db=require('../src/config/database');const account={id:'a',broker:'trading212',account_identifier:'selected',initial_balance_date:'2026-01-01',currency:'USD',initial_balance:100};const records=[{symbol:'LOKB_US_EQ',side:'BUY',date:'2026-01-01',quantity:3},{symbol:'LOKB_US_EQ',side:'SELL',date:'2026-01-04',quantity:3}];const before=JSON.stringify(records);const cash=jest.spyOn(require('../src/services/brokerSync/trading212CashLedger'),'loadLedger').mockResolvedValue({rows:[{date:'2026-01-01',balance:70},{date:'2026-01-04',balance:106}],openingBalance:100,report:{to_date:'2026-01-05'},reconciliation:{matched:true}});db.query.mockImplementation((sql,args)=>Promise.resolve({rows:sql.includes('user_accounts')?[account]:sql.includes('broker_instrument_catalogues')?[{instruments:[{ticker:'LOKB_US_EQ',shortName:'NVTS',isin:'US63942X1063'}]}]:sql.includes('broker_cash_reports')?[{records}]:sql.includes('portfolio_reconstruction_prices')&&args[0]==='NVTS'?[{payload:{currency:'USD',prices:[{date:'2026-01-01',close:10},{date:'2026-01-04',close:12}]}}]:[]}));const client={query:jest.fn().mockResolvedValue({rows:[]})};db.withTransaction=jest.fn(fn=>fn(client));try{await require('../src/services/portfolioReconstructionService').reconstruct('owner',{broker:'trading212',apply:true});expect(db.query.mock.calls.some(([sql,args])=>sql.includes('portfolio_reconstruction_prices')&&args[0]==='NVTS')).toBe(true);const values=client.query.mock.calls.filter(([sql])=>sql.startsWith('INSERT'));expect(values[0][1][3]).toBe(30);expect(values.at(-1)[1][3]).toBe(0);expect(JSON.stringify(records)).toBe(before)}finally{cash.mockRestore();jest.useRealTimers()}});
