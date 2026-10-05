jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/finnhub', () => ({}));
jest.mock('../../src/utils/alphaVantage', () => ({}));
jest.mock('../../src/utils/historicalPriceCache', () => ({}));
jest.mock('../../src/services/holdingsService', () => ({}));
jest.mock('../../src/services/notificationService', () => ({}));
const db = require('../../src/config/database');
const Portfolio = require('../../src/services/portfolioService');
const position = (quantity, price, asOf) => ({ symbol: 'TEST', source: 'trades', instrumentType: 'crypto',
  totalShares: quantity, totalCostBasis: quantity, lotCount: 1, accountIdentifiers: [],
  brokerCurrentPrice: price, brokerPriceAsOf: asOf });
afterEach(() => jest.restoreAllMocks());

test('combined broker holdings preserve the sum of three independently priced balances in either order', () => {
  const inputs = [position(2, 10, '2026-10-03T09:00:00Z'), position(3, 12, '2026-10-03T10:00:00Z'), position(5, 11, '2026-10-03T11:00:00Z')];
  for (const ordered of [inputs, [...inputs].reverse()]) {
    const [combined] = Portfolio._mergePositions([], ordered, {});
    expect(combined.totalShares * combined.brokerCurrentPrice).toBeCloseTo(111, 10);
    expect(combined.brokerPriceAsOf).toBe('2026-10-03T09:00:00.000Z');
  }
  expect(inputs[0].totalShares).toBe(2);
});

test.each([null, undefined])('a component missing its broker price uses the market fallback', missing => {
  const [combined] = Portfolio._mergePositions([], [position(2, 10, '2026-10-03T09:00:00Z'), position(3, missing, '2026-10-03T10:00:00Z')], {});
  expect(combined.brokerCurrentPrice).toBeNull();
  expect(combined.brokerPriceAsOf).toBeNull();
});

test('a manual holding without a dated broker quote does not inherit another account price', () => {
  const manual = { ...position(1, undefined, undefined), source: 'manual' };
  const [combined] = Portfolio._mergePositions([manual], [position(2, 10, '2026-10-03T09:00:00Z')], {});
  expect(combined.totalShares).toBe(3);
  expect(combined.brokerCurrentPrice).toBeNull();
});

test('a newer cached market quote can replace a blended broker valuation', async () => {
  const positions = Portfolio._mergePositions([], [position(2, 10, '2026-10-03T09:00:00Z'), position(3, 12, '2026-10-03T10:00:00Z')], {});
  db.query.mockResolvedValueOnce({ rows: [{ symbol: 'crypto:TEST', data_source:'coingecko', current_price: '13', last_updated: '2026-10-03T11:00:00Z' }] });
  jest.spyOn(Portfolio, '_refreshPricesInBackground').mockImplementation(() => {});
  await Portfolio._applyCurrentPrices('owner', positions);
  expect(positions[0].currentValue).toBe(65);
  expect(positions[0].priceAsOf).toBe('2026-10-03T11:00:00.000Z');
});

test('equity quote cannot replace a crypto broker valuation, including unknown new coins',async()=>{
 const positions=[{...position(2,0.5,new Date().toISOString()),symbol:'NEWCOIN'}];
 db.query.mockResolvedValueOnce({rows:[{symbol:'NEWCOIN',current_price:'40',data_source:'finnhub',last_updated:new Date().toISOString()}]});
 jest.spyOn(Portfolio,'_refreshPricesInBackground').mockImplementation(()=>{});
 await Portfolio._applyCurrentPrices('owner',positions);
 expect(positions[0].currentValue).toBe(1);
});

test('same ticker crypto and stock keep independent quantities and cached values',async()=>{
 const positions=Portfolio._mergePositions([], [
   {...position(2,null,null),symbol:'SUI'},
   {...position(3,null,null),symbol:'SUI',instrumentType:'stock'}
 ], {});
 db.query.mockResolvedValueOnce({rows:[
   {symbol:'crypto:SUI',current_price:'1',data_source:'coingecko',last_updated:new Date().toISOString()},
   {symbol:'SUI',current_price:'100',data_source:'finnhub',last_updated:new Date().toISOString()}
 ]});
 await Portfolio._applyCurrentPrices('owner',positions);
 expect(positions).toHaveLength(2);
 expect(positions.find(p=>p.instrumentType==='crypto').currentValue).toBe(2);
 expect(positions.find(p=>p.instrumentType==='stock').currentValue).toBe(300);
});
