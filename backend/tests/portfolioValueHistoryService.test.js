jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioService',()=>({getPositions:jest.fn()}));
jest.mock('../src/models/Account',()=>({getCashflow:jest.fn()}));
jest.mock('../src/utils/displayCurrency',()=>({getRatesToDisplay:jest.fn()}));
const db=require('../src/config/database'),Portfolio=require('../src/services/portfolioService'),Account=require('../src/models/Account');
const {getRatesToDisplay}=require('../src/utils/displayCurrency');
const {combineValues,captureToday,getHistory}=require('../src/services/portfolioValueHistoryService');
const accounts=[{id:'one',account_identifier:'one',account_name:'First',broker:'ig',currency:'GBP',initial_balance_date:'2024-01-01'},
  {id:'two',account_identifier:'two',account_name:'Second',broker:'ig',currency:'GBP',initial_balance_date:'2024-01-01'}];
const row=(account,date,holdings,cash,stablecoins=0)=>({account_identifier:account,value_date:date,holdings_usd:holdings,cash_usd:cash,stablecoins_usd:stablecoins,gbp_per_usd:.8});
beforeEach(()=>jest.resetAllMocks());
test('combines selected account cash, assets and stablecoins once at the recorded FX rate',()=>{
  const rows=[row('one','2026-01-01',100,20,10),row('two','2026-01-01',30,40)];
  expect(combineValues(rows,accounts,'USD')[0]).toMatchObject({value:200,holdings:130,cash:60,stablecoins:10});
  expect(combineValues(rows,accounts,'GBP')[0].value).toBe(160);
  expect(combineValues(rows,[accounts[0]],'USD')[0].value).toBe(130);
});
test('missing account days and dated FX are gaps rather than zero or invented valuations',()=>{
  const rows=[row('one','2026-01-01',100,20)];
  expect(combineValues(rows,accounts,'USD')[0]).toMatchObject({value:null,missingAccounts:1});
  expect(combineValues([{...rows[0],gbp_per_usd:null}],[accounts[0]],'GBP')[0].value).toBeNull();
});
test('derived gaps never become zero values; complete rebuilt days carry provenance',()=>{
 const gap={...row('one','2026-01-01',100,20),holdings_usd:null,source:'reconstructed'};
 expect(combineValues([gap],[accounts[0]],'USD')[0].value).toBeNull();
 expect(combineValues([{...gap,holdings_usd:100}],[accounts[0]],'USD')[0]).toMatchObject({value:120,reconstructedAccounts:1});
});
test('zero-price estimates are distinguishable from complete observed values',()=>{
 const estimated={...row('one','2026-01-01',100,20),source:'reconstructed',issues:['Estimated at zero: missing historical price for SYNTH']};
 expect(combineValues([estimated,row('two','2026-01-01',30,40)],accounts,'USD')[0]).toMatchObject({value:190,estimatedAccounts:1});
 expect(combineValues([{...estimated,source:'recorded'}],[accounts[0]],'USD')[0].estimatedAccounts).toBe(0);
});
test('migration price estimates carry separate provenance from zero-price estimates',()=>{
 const estimated={...row('one','2025-05-08',100,20),source:'reconstructed',issues:['Estimated using 1:1 token migration: FTM']};
 expect(combineValues([estimated],[accounts[0]],'USD')[0]).toMatchObject({value:120,estimatedAccounts:0,migrationEstimatedAccounts:1});
});
test('IBKR weekend statement estimates remain distinct from reported observations',()=>{
 const point={...row('one','2026-01-17',-10,110),source:'reconstructed',issues:['Estimated using previous IBKR statement: weekend holdings at last reported close']};
 expect(combineValues([point],[accounts[0]],'USD')[0]).toMatchObject({value:100,statementEstimatedAccounts:1,estimatedAccounts:0});
 expect(combineValues([{...point,source:'statement'}],[accounts[0]],'USD')[0].statementEstimatedAccounts).toBe(0);
});
test('captures complete values without counting fiat or stablecoins twice; missing balances are not saved',async()=>{
  db.query.mockResolvedValue({rows:[accounts[0]]});getRatesToDisplay.mockResolvedValue({GBP:1.25,USD:1});
  Portfolio.getPositions.mockResolvedValue([{symbol:'SYNTH',instrumentType:'stock',currentValue:100},
    {symbol:'USDT',instrumentType:'crypto',currentValue:10},{symbol:'USD',instrumentType:'crypto',currentValue:20}]);
  Account.getCashflow.mockResolvedValue({summary:{cashflowSource:'ig_statement',currentBalance:40}});
  expect((await captureToday('owner')).captured).toBe(1);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO portfolio_value_history'),
    ['owner','one',expect.any(String),100,50,10,1,0]);
  db.query.mockClear();Portfolio.getPositions.mockResolvedValue([{currentValue:null}]);
  expect((await captureToday('owner')).unavailable).toBe(1);
  expect(db.query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
});
test('owned account validation prevents snapshots of another user account',async()=>{
  db.query.mockResolvedValue({rows:accounts});
  await expect(captureToday('owner',{accounts:'someone-else'})).rejects.toThrow('unavailable');
  expect(Portfolio.getPositions).not.toHaveBeenCalled();
});
test('cashflow markers do not increase recorded values and internal matched transfers cancel across dates',async()=>{
  const pairs=[{source_account:'one',destination_account:'two',asset:'GBP',quantity:50,sent_at:'2026-01-01',received_at:'2026-01-02'}];
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('FROM user_accounts')?accounts:sql.includes('FROM portfolio_value_history')?[row('one','2026-01-01',100,20),row('two','2026-01-01',30,40)]:sql.includes('broker_transfer_matches')?pairs:[]}));
  Account.getCashflow.mockImplementation((_,id)=>Promise.resolve({cashflow:id==='one'?[{date:'2026-01-01',deposits:100,transferOut:50}]:[{date:'2026-01-02',withdrawals:20,transferIn:50}]}));
  const combined=await getHistory('owner',{currency:'GBP'});
  expect(combined.series[0].value).toBe(152);
  expect(combined.events.map(e=>e.type)).toEqual(['deposit','withdrawal']);
  const selected=await getHistory('owner',{currency:'GBP',accounts:'one'});
  expect(selected.events.map(e=>e.type)).toEqual(['deposit','transfer']);
});
test('date and currency validation apply before history reads',async()=>{
  await expect(getHistory('owner',{currency:'EUR'})).rejects.toThrow('GBP or USD');
  await expect(getHistory('owner',{start_date:'invalid',end_date:'2026-01-01'})).rejects.toThrow('valid');
  expect(db.query).not.toHaveBeenCalled();
});
