jest.mock('../../src/utils/currencyConverter', () => ({
  getForexRate: jest.fn()
}));

const currencyConverter = require('../../src/utils/currencyConverter');
const { convertQuoteCurrency, normaliseMinorUnit } = require('../../src/utils/quoteCurrency');

function quote(overrides = {}) {
  return { c: 100, pc: 80, d: 20, dp: 25, h: 110, l: 90, o: null, currency: 'EUR', ...overrides };
}

describe('convertQuoteCurrency', () => {
  beforeEach(() => jest.clearAllMocks());

  test('restates a EUR quote in the USD the position is booked in', async () => {
    currencyConverter.getForexRate.mockResolvedValue(1.5);

    const converted = await convertQuoteCurrency(quote(), 'USD');

    expect(converted.c).toBeCloseTo(150, 2);
    expect(converted.pc).toBeCloseTo(120, 2);
    expect(converted.currency).toBe('USD');
    expect(converted.converted_from).toBe('EUR');
  });

  test('leaves the percentage change alone, since it is currency-invariant', async () => {
    currencyConverter.getForexRate.mockResolvedValue(1.5);
    const converted = await convertQuoteCurrency(quote(), 'USD');
    expect(converted.dp).toBe(25);
  });

  test('does not call the converter when the currencies already agree', async () => {
    const converted = await convertQuoteCurrency(quote({ currency: 'USD' }), 'USD');
    expect(currencyConverter.getForexRate).not.toHaveBeenCalled();
    expect(converted.c).toBe(100);
  });

  test('treats GBp as pence, not pounds', async () => {
    currencyConverter.getForexRate.mockResolvedValue(2);

    // 1000 pence = GBP 10 = USD 20, not USD 2000.
    const converted = await convertQuoteCurrency(quote({ c: 1000, pc: 900, d: 100, currency: 'GBp' }), 'USD');

    expect(converted.c).toBeCloseTo(20, 3);
    expect(currencyConverter.getForexRate).toHaveBeenCalledWith('GBP', 'USD');
  });

  test('handles the GBX spelling of pence too', async () => {
    currencyConverter.getForexRate.mockResolvedValue(2);
    const converted = await convertQuoteCurrency(quote({ c: 1000, currency: 'GBX' }), 'USD');
    expect(converted.c).toBeCloseTo(20, 3);
  });

  test('converts pence to pounds without a rate lookup', async () => {
    const converted = await convertQuoteCurrency(quote({ c: 1000, currency: 'GBp' }), 'GBP');
    expect(converted.c).toBeCloseTo(10, 3);
    expect(currencyConverter.getForexRate).not.toHaveBeenCalled();
  });

  test('throws rather than returning an unconvertible number', async () => {
    currencyConverter.getForexRate.mockRejectedValue(new Error('no rate'));
    await expect(convertQuoteCurrency(quote(), 'USD')).rejects.toThrow('no rate');
  });

  test('throws when the converter returns nonsense', async () => {
    currencyConverter.getForexRate.mockResolvedValue(0);
    await expect(convertQuoteCurrency(quote(), 'USD')).rejects.toThrow(/invalid rate/);
  });

  test('normaliseMinorUnit distinguishes the major and minor forms', () => {
    expect(normaliseMinorUnit('GBp')).toEqual({ code: 'GBP', divisor: 100 });
    expect(normaliseMinorUnit('GBP')).toEqual({ code: 'GBP', divisor: 1 });
    expect(normaliseMinorUnit('EUR')).toEqual({ code: 'EUR', divisor: 1 });
  });
});
