jest.mock('../../src/services/tierService', () => ({}));
jest.mock('../../src/utils/finnhub', () => ({}));
jest.mock('../../src/utils/alphaVantage', () => ({}));
jest.mock('../../src/utils/databento', () => ({}));
jest.mock('../../src/services/replayDataService', () => ({}));
jest.mock('../../src/models/User', () => ({ getSettings: jest.fn() }));
jest.mock('../../src/utils/currencyConverter', () => ({ getDailyCrossRate: jest.fn() }));
jest.mock('axios', () => ({}));

const ChartService = require('../../src/services/chartService');
const User = require('../../src/models/User');
const converter = require('../../src/utils/currencyConverter');
const contracts = require('../../../tests/fixtures/trading-calculation-contracts.json');

describe('chart display currency contracts', () => {
  test.each(contracts.chart_currency_cases)('$id', async (fixture) => {
    User.getSettings.mockResolvedValue({ display_currency: fixture.display_currency });
    converter.getDailyCrossRate.mockImplementation(async (from) => {
      if (fixture.rates[from]) return fixture.rates[from];
      throw new Error('FX unavailable');
    });
    const before = JSON.stringify(fixture.chart_data);
    for (let request = 0; request < 2; request++) {
      const out = await ChartService.convertTradeChartForDisplay(
        { user: { id: 'user' } }, fixture.chart_data, fixture.source_currency
      );
      expect(out.candles[0].close).toBeCloseTo(fixture.expected.close);
      expect(out.candles[0].volume).toBe(fixture.expected.volume);
      expect(out.candles_currency).toBe(fixture.expected.candles_currency);
      expect(out.trade.effective_currency).toBe(fixture.expected.effective_currency);
      expect(out.trade.entryPrice).toBeCloseTo(fixture.expected.entry_price);
      expect(out.price_scale).toBe(fixture.expected.price_scale);
    }
    expect(JSON.stringify(fixture.chart_data)).toBe(before);
  });
});

test('mixed-account plan markers retain native quotes rather than cash FX prices',async()=>{
 User.getSettings.mockResolvedValue({display_currency:'GBP'});
 converter.getDailyCrossRate.mockImplementation(async from=>({EUR:.9,USD:.8,GBP:1})[from]);
 const chart={candles:[{open:100,high:101,low:99,close:100,volume:10}],trade:{original_currency:'GBP',currency:'GBP',entryPrice:80,executions:[{price:80,source_price:100,source_price_currency:'EUR'},{price:48,source_price:60,source_price_currency:'USD'}]}};
 const out=await ChartService.convertTradeChartForDisplay({user:{id:'user'}},chart,'EUR');
 expect(out.trade.executions.map(e=>e.price)).toEqual([90,48]);
 expect(out.trade.executions[0].source_price).toBe(100);
 expect(chart.trade.executions[0].price).toBe(80);
});
