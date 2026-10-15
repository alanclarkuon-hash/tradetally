const util = require('util');
const { parseCSV } = require('../../src/utils/csvParser');
const { parseWebullTransactions } = require('../../src/utils/csv/parsers/webull');
const { parseDateTime } = require('../../src/utils/csv/shared');
const symbol = 'PRIVSTOCK';
const account = 'synthetic-private-account';
const user = 'synthetic-private-user';
const time = '01/02/2025 10:00:00';
const header = 'Name,Symbol,Side,Status,Filled,Price,Filled Time,Commission,Account,PrivateHeader,Time-in-Force,Placed Time';
const buy = `Private holder,${symbol},Buy,Filled,7,123.45,01/01/2025 09:30:00,0.75,${account},private-row-marker,Day,01/01/2025 09:30:00`;
const sell = `Private holder,${symbol},Sell,Filled,7,126.45,${time},1.25,${account},private-row-marker,Day,01/01/2025 09:30:00`;
let spies;
beforeEach(() => {
  spies = ['log', 'warn', 'error', 'info', 'debug'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => { spies.forEach(spy => spy.mockRestore()); });
function output() { return spies.flatMap(spy => spy.mock.calls).map(args => util.format(...args)).join('\n'); }
function expectPrivate() {
  for (const marker of [symbol, account, user, 'private-row-marker', 'Private holder', '123.45', '126.45', time, 'synthetic-existing-trade', 'synthetic-invalid-date']) {
    expect(output()).not.toContain(marker);
  }
}
const context = () => ({ userId: user, selectedAccountId: account,
  existingPositions: { OTHERPRIVATE: { id: 'synthetic-existing-trade', side: 'long', quantity: 567, entryPrice: 987.65 } }
});
test.each(['webull', 'auto', 'generic'])('full %s import logs contain no raw records, account, holdings or financial values', async broker => {
  const result = await parseCSV(Buffer.from([header, buy, sell].join('\n')), broker, context());
  expect(result.trades).toHaveLength(1);
  expect(result.trades[0]).toMatchObject({ symbol, quantity: 7, entryPrice: 123.45, exitPrice: 126.45, pnl: 19, commission: 2, accountIdentifier: account });
  expect(output()).toContain('[WEBULL] Import parsing complete');
  expectPrivate();
  expect(output()).not.toContain('OTHERPRIVATE');
  expect(output()).not.toContain('987.65');
});
test('skipped and invalid row diagnostics remain available without logging their data', async () => {
  const diagnostics = {};
  const result = await parseWebullTransactions([
    { Symbol: symbol, Side: 'Buy', Status: 'Cancelled', Filled: 7 },
    { Symbol: symbol, Side: 'Buy', Status: 'Filled', Filled: 7, Price: 123.45, 'Filled Time': 'synthetic-invalid-date' }
  ], {}, { diagnostics });
  expect(result).toEqual([]);
  expect(diagnostics).toMatchObject({ skippedRows: 1, invalidRows: 1 });
  expect(diagnostics.skippedReasons).toContainEqual({ row: 2, reason: 'Invalid filled time: synthetic-invalid-date' });
  expectPrivate();
});
test('row exceptions do not log the error message, stack or raw row', async () => {
  const row = { get Symbol() { throw new Error('private-row-marker'); } };
  const result = await parseWebullTransactions([row]);
  expect(result).toEqual([]);
  expect(output()).toContain('[WEBULL] Unable to parse an import row { row: 1 }');
  expectPrivate();
});
test('existing-position closes preserve matching and P/L without position logs', async () => {
  const existing = { [symbol]: { id: 'synthetic-existing-trade', quantity: 7, entryPrice: 123.45,
    side: 'long', commission: 0.75, entryTime: '2025-01-01T09:30:00', tradeDate: '2025-01-01',
    executions: [{ action: 'buy', quantity: 7, price: 123.45, datetime: '2025-01-01T09:30:00', fees: 0.75 }] } };
  const result = await parseWebullTransactions([{ Symbol: symbol, Side: 'Sell', Status: 'Filled', Filled: 7, Price: 126.45,
    'Filled Time': time, Commission: 1.25 }], existing);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ existingTradeId: 'synthetic-existing-trade', isUpdate: true, quantity: 7, pnl: 19 });
  expectPrivate();
});
test('duplicate executions remain skipped without execution-value logs', async () => {
  const row = { Symbol: symbol, Side: 'Buy', Status: 'Filled', Filled: 7, Price: 123.45, 'Filled Time': time };
  const result = await parseWebullTransactions([row], {}, { existingExecutions: { [symbol]: [
    { action: 'buy', quantity: 7, price: 123.45, datetime: parseDateTime(time) }
  ] } });
  expect(result).toEqual([]);
  expectPrivate();
});
test('malformed CSV logs do not include fields embedded in parser errors', async () => {
  const result = await parseCSV(Buffer.from(header + '\n"private-row-marker'), 'webull', context());
  expect(result.trades).toEqual([]);
  expectPrivate();
});

test('generic format fallback cannot reintroduce financial logs', async () => {
  const csv = [header.replace(',Time-in-Force,Placed Time', ''),
    buy.replace(',Day,01/01/2025 09:30:00', ''), sell.replace(',Day,01/01/2025 09:30:00', '')].join('\n');
  const result = await parseCSV(Buffer.from(csv), 'generic', context());
  expect(result.trades).toHaveLength(1);
  expect(result.trades[0]).toMatchObject({ symbol, pnl: 19 });
  expectPrivate();
});
