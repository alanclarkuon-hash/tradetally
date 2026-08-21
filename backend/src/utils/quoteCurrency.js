const currencyConverter = require('./currencyConverter');

// Yahoo quotes UK listings in pence under the code "GBp"/"GBX", not pounds.
// Treating that as GBP overstates a price a hundredfold.
const MINOR_UNITS = {
  GBP: { code: 'GBP', divisor: 100 },
  ZAR: { code: 'ZAR', divisor: 100 },
  ILS: { code: 'ILS', divisor: 100 }
};

function normaliseMinorUnit(currency) {
  const raw = String(currency || '').trim();
  if (!raw) return null;

  // The minor-unit form is signalled by case ("GBp") or an X suffix ("GBX").
  const upper = raw.toUpperCase();
  const isMinor = (raw !== upper && raw.length === 3) || upper.endsWith('X');
  const base = upper.endsWith('X') ? `${upper.slice(0, 2)}P` : upper;

  if (isMinor && MINOR_UNITS[base]) {
    return { code: MINOR_UNITS[base].code, divisor: MINOR_UNITS[base].divisor };
  }

  return { code: upper, divisor: 1 };
}

/**
 * Restate a quote in `targetCurrency`. Prices are scaled; percentage change is
 * currency-invariant and left alone. Throws when a rate cannot be obtained, so
 * the caller drops the quote rather than showing an unlabelled number.
 */
async function convertQuoteCurrency(quote, targetCurrency) {
  if (!quote) return quote;

  const target = String(targetCurrency || '').trim().toUpperCase();
  const source = normaliseMinorUnit(quote.currency);

  // Nothing to do without both sides, or when they already agree in the major unit.
  if (!target || !source) return quote;
  if (source.code === target && source.divisor === 1) return quote;

  const rate = source.code === target
    ? 1
    : await currencyConverter.getForexRate(source.code, target);

  if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) {
    throw new Error(`invalid rate ${rate}`);
  }

  const factor = Number(rate) / source.divisor;
  const scale = (value) => (Number.isFinite(Number(value)) ? Number(value) * factor : value);

  return {
    ...quote,
    c: scale(quote.c),
    pc: scale(quote.pc),
    d: scale(quote.d),
    h: scale(quote.h),
    l: scale(quote.l),
    o: scale(quote.o),
    dp: quote.dp,
    currency: target,
    converted_from: quote.currency,
    fx_rate: factor
  };
}

module.exports = { convertQuoteCurrency, normaliseMinorUnit };
