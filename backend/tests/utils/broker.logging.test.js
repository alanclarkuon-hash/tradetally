const util = require('util');
jest.mock('../../src/config/database', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(),warn:jest.fn(),error:jest.fn(),debug:jest.fn() }));
jest.mock('../../src/utils/finnhub', () => ({}));
jest.mock('../../src/utils/cusipQueue', () => ({ addToQueue: jest.fn() }));
jest.mock('../../src/utils/cache', () => ({ get:jest.fn(),set:jest.fn(),del:jest.fn(),data:{} }));
jest.mock('../../src/utils/currencyConverter', () => ({ convertTradeToUSD:jest.fn(t=>t),userHasProAccess:jest.fn().mockResolvedValue(false) }));
const logger = require('../../src/utils/logger');
const cases = [
 ['firstrade','parseFirstradeTransactions'], ['ibkr','parseIBKRTransactions'],
 ['lightspeed','parseLightspeedTransactions'], ['papermoney','parsePaperMoneyTransactions'],
 ['questrade','parseQuestradeTransactions'], ['schwab','parseSchwabTrades'],
 ['schwab','parseSchwabTransactions'], ['tastytrade','parseTastytradeTransactions'],
 ['thinkorswim','parseThinkorswimTransactions'], ['tradingview','parseTradingViewTransactions'],
 ['tradingview','parseTradingViewPaperTrades'], ['tradovate','parseTradovateTransactions'],
 ['tradovate','parseTradovatePerformanceReport']
];
const parsers = cases.map(([name,method]) => [name,method,require('../../src/utils/csv/parsers/'+name)[method]]);
let spies;
beforeEach(() => {
 jest.clearAllMocks(); process.env.DEBUG_IMPORT='true';
 spies=['log','warn','error','info','debug'].map(level=>jest.spyOn(console,level).mockImplementation(()=>{}));
});
afterEach(() => { spies.forEach(spy=>spy.mockRestore()); delete process.env.DEBUG_IMPORT; });
const marker='PRIVATE-IMPORT-MARKER';
function logs() { return [...spies,...Object.values(logger)].flatMap(spy=>spy.mock.calls).map(args=>util.format(...args)).join('\n'); }
const record=()=>({ Name:marker,Symbol:marker,symbol:marker,Description:marker,Action:'Buy',Side:'Buy',Status:'Filled',Filled:7,
 'Filled Qty':7,'Avg Price':123.45,'Price':123.45,Quantity:7,'B/S':'Buy','Buy/Sell':'BUY',
 'TradePrice':123.45, 'Trade Price':123.45,'Buy/Sell Indicator':'BUY',Date:'2025-01-02',
 'Trade Date':'2025-01-02','Date/Time':'2025-01-02 09:30:00','Filled Time':'01/02/2025 09:30:00',
 'Account':marker,'Account ID':marker,'Order ID':marker,'Execution ID':marker,Commission:0.75 });
const positions=()=>({[marker]:{id:marker,side:'long',quantity:7,entryPrice:123.45,commission:0.75,executions:[],entryTime:'2025-01-01T09:30:00'}});
test.each(parsers)('%s %s never logs source rows or existing position values', async (name,method,parse) => {
 expect(typeof parse).toBe('function');
 const context={userId:marker,selectedAccountId:marker,diagnostics:{invalidRows:0,skippedRows:0,skippedReasons:[],warnings:[]}};
 // Some formats reject this synthetic row; both normal and validation logs must remain private.
 try { await parse([record()],positions(),context); } catch (_) { /* returned errors are not access logs */ }
 expect(logs()).not.toBe('');
 expect(logs()).not.toContain(marker);
 expect(logs()).not.toContain('123.45');
 expect(logs()).not.toContain('0.75');
});
