jest.mock('../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../src/services/brokerSync/etoroWorkbook',()=>({read:jest.fn()}));
jest.mock('../src/services/brokerSync/etoroCashStatement',()=>({prepare:jest.fn()}));
const db=require('../src/config/database'),{read}=require('../src/services/brokerSync/etoroWorkbook'),{prepare}=require('../src/services/brokerSync/etoroCashStatement');
const {captureEtoroStatement}=require('../src/services/portfolioStatementHistoryService');
const hash=require('crypto').createHash('sha256').update(JSON.stringify('synthetic')).digest('hex');
beforeEach(()=>{
 jest.resetAllMocks();
 read.mockResolvedValue({username:'synthetic',start:'2025-01-02',end:'2025-01-03',equity:{openingTotalUSD:110,closingTotalUSD:150},statement:{'Account Activity':[{Date:'02/01/2025 00:00:00'}]}});
 prepare.mockReturnValue({records:[{reference:'two',cash:20}]});
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('broker_connections')?[{account_identifier:'owned',currency:'USD',initial_balance_date:'2025-01-01',broker_metadata:{statement_identity_hash:hash}}]:[{to_date:'2025-01-03',starting_cash:0,records:[{date:'2025-01-01',time:'2025-01-01T00:00:00.000Z',reference:'one',cash:100},{date:'2025-01-02',time:'2025-01-02T00:00:00.000Z',reference:'two',cash:20}]}]}));
});
test('captures broker statement total minus independently reconciled cash, without importing payments',async()=>{
 const client={query:jest.fn(sql=>Promise.resolve({rows:sql.includes('fx_daily_rates')?[{rates:{GBP:.8}}]:[]}))};
 db.withTransaction.mockImplementation(fn=>fn(client));
 expect(await captureEtoroStatement('owner','account',Buffer.alloc(0))).toEqual({captured:2});
 const writes=client.query.mock.calls.filter(([sql])=>sql.includes('INSERT'));
 expect(writes.map(([,args])=>args.slice(2,5))).toEqual([['2025-01-01',10,100],['2025-01-03',30,120]]);
 expect(writes.every(([sql])=>sql.includes('portfolio_statement_values'))).toBe(true);
});
test('rejects a different statement account before any writes',async()=>{
 read.mockResolvedValue({...await read(),username:'other'});
 await expect(captureEtoroStatement('owner','account',Buffer.alloc(0))).rejects.toThrow('identity');
 expect(db.withTransaction).not.toHaveBeenCalled();
});
test('rejects changed cash history instead of inventing a statement valuation',async()=>{
 prepare.mockReturnValue({records:[{reference:'different',cash:20}]});
 await expect(captureEtoroStatement('owner','account',Buffer.alloc(0))).rejects.toThrow('differs');
 expect(db.withTransaction).not.toHaveBeenCalled();
});
