jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioService',()=>({getPositions:jest.fn()}));
jest.mock('../src/models/Account',()=>({getCashflow:jest.fn()}));
jest.mock('../src/utils/displayCurrency',()=>({getRatesToDisplay:jest.fn()}));
jest.mock('../src/utils/yahooFinance',()=>({getSymbolProfile:jest.fn(),getStockTradeChartData:jest.fn()}));
jest.mock('../src/utils/currencyConverter',()=>({getForexRate:jest.fn()}));
jest.mock('../src/services/cryptoCategoriesService',()=>({getCategories:jest.fn().mockResolvedValue({categories:[],primaryCategory:null})}));
const db=require('../src/config/database'),Portfolio=require('../src/services/portfolioService'),Account=require('../src/models/Account');
const {getRatesToDisplay}=require('../src/utils/displayCurrency');
const {getDashboard,periodResult}=require('../src/services/portfolioDashboardService');
const position={symbol:'USDT',instrumentType:'crypto',totalShares:100,currentValue:100,totalCostBasis:100,unrealizedPnL:0,unrealizedPnLPercent:0};
beforeEach(()=>jest.resetAllMocks());
test('stablecoin wallet is counted once and selected accounts stay isolated',async()=>{
  Portfolio.getPositions.mockResolvedValue([position]);getRatesToDisplay.mockResolvedValue({USD:1});
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('FROM user_accounts')?[{id:'one',account_identifier:'okx-demo',account_name:'Example',broker:'okx',currency:'USD'},{id:'two',account_identifier:'other',broker:'ibkr',currency:'USD'}]:[]}));
  const result=await getDashboard('test-user',{currency:'USD',accounts:'okx-demo'});
  expect(result.totals.portfolioValue).toBe(100);expect(result.totals.holdingsValue).toBe(0);expect(result.totals.cashValue).toBe(0);
  expect(result.accountCount).toBe(1);expect(Account.getCashflow).not.toHaveBeenCalled();
  expect(Portfolio.getPositions).toHaveBeenCalledWith('test-user',{accounts:'okx-demo'});
});
test('unknown cash is flagged instead of treating trade equity as cash',async()=>{
  Portfolio.getPositions.mockResolvedValue([]);getRatesToDisplay.mockResolvedValue({USD:1});
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('FROM user_accounts')?[{id:'one',account_identifier:'demo',broker:'ibkr',currency:'USD'}]:[]}));
  Account.getCashflow.mockResolvedValue({summary:{currentBalance:500,cashflowSource:'trade_history'}});
  const result=await getDashboard('test-user',{currency:'USD'});expect(result.coverage.missingCash).toBe(1);expect(result.totals.cashValue).toBe(0);
});
test('period P&L requires matching lots and explicit historical USD prices',()=>{
  const p={...position,symbol:'BTC',currentPrice:12};const range={start_date:'2026-01-01',end_date:'2026-02-01'};
  const lots=[{quantity:100,price:8,acquired:new Date('2025-12-01')}];
  expect(periodResult(p,range,{},lots).pnl).toBeNull();
  expect(periodResult(p,range,{'2026-01-01':10,'2026-02-01':12},lots)).toEqual({pnl:200,percent:20,basis:1000});
  expect(periodResult({...p,totalShares:50},range,{'2026-01-01':10,'2026-02-01':12},lots).pnl).toBeNull();
});
test('dated stock candles are converted to USD before comparing portfolio prices',async()=>{
  Portfolio.getPositions.mockResolvedValue([{...position,symbol:'SYNTH.L',instrumentType:'stock',currentPrice:3}]);
  getRatesToDisplay.mockResolvedValue({USD:1});
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('FROM trades')?[{symbol:'SYNTH.L',quantity:100,price:1,acquired:'2025-01-01'}]:[]}));
  require('../src/utils/yahooFinance').getStockTradeChartData.mockResolvedValue({candles_currency:'GBP',candles:[{time:Date.parse('2026-01-01')/1000,close:1},{time:Date.parse('2026-02-01')/1000,close:2}]});
  require('../src/utils/currencyConverter').getForexRate.mockResolvedValue(1.25);
  const result=await getDashboard('test-user',{currency:'USD',start_date:'2026-01-01',end_date:'2026-02-01'});
  expect(result.holdings[0].pnl).toBe(125);expect(result.holdings[0].pnlPercent).toBe(100);
  expect(require('../src/utils/currencyConverter').getForexRate).toHaveBeenCalledWith('GBP','USD','2026-01-01');
});

