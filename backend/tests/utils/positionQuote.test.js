const { usesEquityQuotes, selectPositionQuote } = require('../../src/utils/positionQuote');
const { getPositionKey } = require('../../src/utils/openPositionGrouping');

test('SUI crypto uses its broker price despite a same-symbol equity quote', () => {
  const brokerQuote = { c: 1.18, asOf: '2026-10-03T00:00:00Z' };
  const position = { symbol: 'SUI', instrumentType: 'crypto', brokerQuote };
  expect(usesEquityQuotes(position)).toBe(false);
  const quote = selectPositionQuote(position, { c: 110.75 }, { c: 110.75 });
  expect(quote).toBe(brokerQuote);
  expect(quote.c * 80 - 90).toBeCloseTo(4.4);
});

test('crypto without a broker price stays unpriced rather than using an equity quote', () => {
  expect(selectPositionQuote({ instrumentType: 'crypto' }, null, { c: 110.75 })).toBeNull();
});

test('stock quotes remain independent of same-symbol crypto positions', () => {
  const trade = { symbol: 'SUI', original_currency: 'USD' };
  expect(getPositionKey({ ...trade, instrument_type: 'crypto' }))
    .not.toBe(getPositionKey({ ...trade, instrument_type: 'stock' }));
  const stock = { instrumentType: 'stock', brokerQuote: { c: 109 } };
  const market = { c: 110.75 };
  expect(usesEquityQuotes(stock)).toBe(true);
  expect(selectPositionQuote(stock, null, market)).toBe(market);
});
