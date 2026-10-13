// Constructing Intl formatters for every execution is expensive. Share the
// same calendar formatter across reads and the P&L engine, bounded by timezone.
const formatters = new Map();
const MAX_FORMATTERS = 32;

function calendarDateFormatter(timezone) {
  const zone = timezone || 'UTC';
  if (formatters.has(zone)) return formatters.get(zone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  if (formatters.size >= MAX_FORMATTERS) formatters.delete(formatters.keys().next().value);
  formatters.set(zone, formatter);
  return formatter;
}

module.exports = { calendarDateFormatter };
