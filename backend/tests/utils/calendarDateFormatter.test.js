const { calendarDateFormatter } = require('../../src/utils/calendarDateFormatter');

test('reuses the formatter per timezone without changing local calendar dates', () => {
  const london = calendarDateFormatter('Europe/London');
  expect(calendarDateFormatter('Europe/London')).toBe(london);
  expect(calendarDateFormatter('America/New_York')).not.toBe(london);
  for (const zone of ['UTC', 'Europe/London', 'America/New_York']) {
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
    });
    // Midnight and the DST transitions can change the realised-P&L date.
    for (const stamp of ['2025-03-30T00:30:00Z', '2025-03-30T23:30:00Z', '2025-10-26T01:30:00Z']) {
      expect(calendarDateFormatter(zone).formatToParts(new Date(stamp)))
        .toEqual(expected.formatToParts(new Date(stamp)));
    }
  }
});

test('invalid timezones still throw for the existing caller fallback', () => {
  expect(() => calendarDateFormatter('Invalid/Timezone')).toThrow(RangeError);
});
