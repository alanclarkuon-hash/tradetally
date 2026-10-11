jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioService',()=>({getPositions:jest.fn()}));
jest.mock('../src/models/Account',()=>({getCashflow:jest.fn()}));
jest.mock('../src/utils/displayCurrency',()=>({getRatesToDisplay:jest.fn()}));
jest.mock('../src/utils/yahooFinance',()=>({getSymbolProfile:jest.fn(),getStockTradeChartData:jest.fn()}));
jest.mock('../src/utils/currencyConverter',()=>({getForexRate:jest.fn()}));
jest.mock('../src/services/cryptoCategoriesService',()=>({getDisplayCategories:jest.fn().mockResolvedValue({categories:[],primaryCategory:null})}));
jest.mock('../src/services/fundCategoriesService',()=>({getCategories:jest.fn()}));
jest.mock('../src/services/assetClassificationService',()=>({getClassifications:jest.fn()}));
const db=require('../src/config/database'),Portfolio=require('../src/services/portfolioService'),Account=require('../src/models/Account');
const {getRatesToDisplay}=require('../src/utils/displayCurrency');
const {getDashboard,periodResult}=require('../src/services/portfolioDashboardService');
const position={symbol:'USDT',instrumentType:'crypto',totalShares:100,currentValue:100,totalCostBasis:100,unrealizedPnL:0,unrealizedPnLPercent:0};
beforeEach(()=>{jest.resetAllMocks();require('../src/services/assetClassificationService').getClassifications.mockResolvedValue(new Map());});
test('current ticker uses original account lots for period P&L and current market symbol for charts',async()=>{
  Portfolio.getPositions.mockResolvedValue([{...position,symbol:'NEW',name:'Current company',sourceSymbols:['OLD'],accountIdentifiers:['demo'],instrumentType:'stock',currentPrice:3}]);
  getRatesToDisplay.mockResolvedValue({USD:1});
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('FROM trades')?[{symbol:'OLD',account_identifier:'demo',quantity:100,price:1,acquired:'2025-01-01'}]:[]}));
  require('../src/utils/yahooFinance').getStockTradeChartData.mockResolvedValue({candles_currency:'USD',candles:[{time:Date.parse('2026-01-01')/1000,close:1},{time:Date.parse('2026-02-01')/1000,close:2}]});
  require('../src/utils/currencyConverter').getForexRate.mockResolvedValue(1);
  const result=await getDashboard('test-user',{currency:'USD',start_date:'2026-01-01',end_date:'2026-02-01'});
  expect(result.holdings[0]).toMatchObject({symbol:'NEW',name:'Current company',pnl:100,pnlPercent:100});
  expect(require('../src/utils/yahooFinance').getStockTradeChartData).toHaveBeenCalledWith('NEW',expect.any(String),expect.any(String),'D');
});
test('fund identity overrides cached industry and keeps value counted once',async()=>{
  Portfolio.getPositions.mockResolvedValue([{...position,symbol:'EXAMPLE.L',instrumentType:'stock'}]);
  getRatesToDisplay.mockResolvedValue({USD:1});
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('classifications')?[{symbol:'EXAMPLE.L',industry:'Incorrect stock industry'}]:[]}));
  require('../src/utils/yahooFinance').getSymbolProfile.mockResolvedValue({quoteType:'ETF'});
  require('../src/services/fundCategoriesService').getCategories.mockResolvedValue({primaryCategory:'Technology',categories:['Fund Category: Technology'],source:'Yahoo Finance'});
  const result=await getDashboard('test-user',{currency:'USD'});
  expect(result.holdings[0]).toMatchObject({assetClass:'Funds & ETFs',category:'Technology',categorySource:'Yahoo Finance'});
  expect(result.totals.holdingsValue).toBe(100);expect(result.holdings).toHaveLength(1);
});
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

test('sub-cent coins use precise portfolio value rather than a rounded zero quote',()=>{
 const today=new Date().toISOString().slice(0,10);
 const result=periodResult({...position,symbol:'SHIB',totalShares:1000000,currentPrice:0,currentValue:12},
   {start_date:'2026-01-01',end_date:today},{'2026-01-01':0.00001},
   [{quantity:1000000,price:0.000008,acquired:'2025-01-01'}]);
 expect(result.pnl).toBeCloseTo(2);
});

test('retains known P&L and names excluded holdings without claiming a complete total',async()=>{
 Portfolio.getPositions.mockResolvedValue([{...position,symbol:'BTC',unrealizedPnL:20},{...position,symbol:'UNKNOWN',unrealizedPnL:null}]);
 getRatesToDisplay.mockResolvedValue({USD:1});db.query.mockResolvedValue({rows:[]});
 require('../src/services/cryptoCategoriesService').getDisplayCategories.mockResolvedValue({categories:[],primaryCategory:null});
 const result=await getDashboard('test-user',{currency:'USD'});
 expect(result.totals).toMatchObject({pnl:null,knownPnl:20});
 expect(result.coverage.missingPnlSymbols).toEqual(['UNKNOWN']);
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

test('stock reference grouping does not change valuation or reuse provider industry',async()=>{
  Portfolio.getPositions.mockResolvedValue([{...position,symbol:'MSFT',instrumentType:'stock'}]);
  getRatesToDisplay.mockResolvedValue({USD:1});db.query.mockResolvedValue({rows:[]});
  require('../src/utils/yahooFinance').getSymbolProfile.mockResolvedValue({quoteType:'EQUITY',industry:'Software—Infrastructure'});
  require('../src/services/assetClassificationService').getClassifications.mockResolvedValue(new Map([['MSFT',{sector_name:'Information Technology',industry_name:'Software',industry_group_name:'Software & Services',source:'FinanceDatabase'}]]));
  const result=await getDashboard('test-user',{currency:'USD'});
  expect(result.holdings[0]).toMatchObject({assetClass:'Stocks',sector:'Information Technology',industry:'Software',value:100});
  expect(result.totals.holdingsValue).toBe(100);
});



test('crypto range P&L can reuse stored USD closes without a Kraken holding',async()=>{
 Portfolio.getPositions.mockResolvedValue([{...position,symbol:'NEAR',currentPrice:12}]);
 getRatesToDisplay.mockResolvedValue({USD:1});
 require('../src/services/cryptoCategoriesService').getDisplayCategories.mockResolvedValue({categories:[],primaryCategory:null});
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('FROM trades')?[{symbol:'NEAR',quantity:100,price:8,acquired:'2025-12-01'}]:sql.includes('portfolio_reconstruction_prices')?[{symbol:'NEAR-USD',payload:{currency:'USD',prices:[{date:'2026-01-01',close:10},{date:'2026-02-01',close:12}]}}]:[]}));
 const result=await getDashboard('test-user',{currency:'USD',start_date:'2026-01-01',end_date:'2026-02-01'});
 expect(result.holdings[0]).toMatchObject({pnl:200,pnlPercent:20});
});

test.each([['GBP',1,0.8,80],['USD',1.25,1,100]])('IG statement cash preserves native GBP before conversion to %s',async(currency,gbpRate,usdRate,expected)=>{
 Portfolio.getPositions.mockResolvedValue([]);getRatesToDisplay.mockResolvedValue({USD:usdRate,GBP:gbpRate});
 db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('FROM user_accounts')?[{id:'one',account_identifier:'demo',broker:'ig',currency:'GBP'}]:sql.includes('FROM portfolio_statement_values')?[{cash_usd:100,gbp_per_usd:0.8}]:[]}));
 const result=await getDashboard('owner',{currency});expect(result.totals.cashValue).toBe(expected);expect(Account.getCashflow).not.toHaveBeenCalled();
});

test('EUR dashboard converts native USD holdings to EUR',async()=>{
 Portfolio.getPositions.mockResolvedValue([position]);getRatesToDisplay.mockResolvedValue({USD:.9});
 db.query.mockResolvedValue({rows:[]});
 const result=await getDashboard('synthetic',{currency:'EUR'});
 expect(result.currency).toBe('EUR');expect(result.totals.stablecoinValue).toBe(90);
 expect(getRatesToDisplay).toHaveBeenCalledWith(['USD'],'EUR');
});
