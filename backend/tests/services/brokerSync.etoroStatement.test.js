jest.mock('../../src/config/database', () => ({ withTransaction: jest.fn() }));
jest.mock('../../src/services/analyticsCache', () => ({ invalidate: jest.fn() }));
const db = require('../../src/config/database');
const { mapClosedPositions, statementDate, matches, importClosedPositions } = require('../../src/services/brokerSync/etoroStatement');
const row = { 'Position ID': '123', Action: 'Synthetic Asset (SYNTH)', Type: 'CFD',
  'Long / Short': 'Short', Amount: 50, 'Units / Contracts': '2', Leverage: 2,
  'FX rate at open (USD)': '-', 'FX rate at close (USD)': '-', 'Open Rate': 50, 'Close Rate': 40,
  'Profit(USD)': 19.5, 'Open Date': '01/11/2021 21:26:55', 'Close Date': '02/11/2021 22:26:55',
  'Copied From': 'Synthetic Strategy', 'Spread Fees (USD)': 0.5,
  'Market Spread (USD)': 0, 'Overnight Fees and Dividends': -0.2 };
test('preserves CFD classification, copied origin, reported USD profit and margin return', () => {
  const t = mapClosedPositions([row])[0];
  expect(t).toMatchObject({ type: 'cfd', side: 'short', pnl: 19.5, pnlPercent: 39, symbol: 'SYNTH' });
  expect(t.executions[1]).toMatchObject({ realized_pnl: 19.5, etoro_copied_from: 'Synthetic Strategy', etoro_leverage: 2 });
});
test('parses UK dates explicitly and rejects impossible dates', () => {
  expect(statementDate('01/11/2021 21:26:55')).toBe('2021-11-01T21:26:55.000Z');
  expect(() => statementDate('31/02/2021 00:00:00')).toThrow();
});
test('retains a delisting at zero and corporate allocation with no invested capital', () => {
  expect(mapClosedPositions([{...row,Amount:0,'Open Rate':0,'Close Rate':0}])[0])
    .toMatchObject({entryPrice:0,exitPrice:0,pnlPercent:null});
});
test('converts native rates with statement FX while retaining the broker profit', () => {
  const t = mapClosedPositions([{ ...row, 'FX rate at open (USD)': '1.25', 'FX rate at close (USD)': '1.3' }])[0];
  expect(t).toMatchObject({ entryPrice: 62.5, exitPrice: 52, pnl: 19.5 });
});
test('detects API overlap despite sub-second timestamps and refuses mismatched quantities', () => {
  const t = mapClosedPositions([row])[0];
  const old = { quantity: 2, pnl: 19.5, entry_time: '2021-11-01T21:26:55.654Z', exit_time: '2021-11-02T22:26:55.123Z' };
  expect(matches(old,t)).toBe(true);
  expect(matches({ ...old, quantity: 3 },t)).toBe(false);
});
test('repeat statement imports skip matched broker records and write no new trades', async () => {
  const t = mapClosedPositions([row])[0];
  const query = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
    quantity: t.quantity, pnl: t.pnl, entry_time: t.entryTime, exit_time: t.exitTime,
    symbol: t.symbol, executions: t.executions }] }).mockResolvedValue({ rows: [] });
  db.withTransaction.mockImplementation(fn=>fn({query}));
  expect(await importClosedPositions({ id:'c',userId:'u',externalAccountId:'123' },
    { 'Closed Positions':[row] })).toMatchObject({ imported:0,matched:1 });
  expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO trades'))).toBe(false);
});
test('conflicting overlaps stop before any insert', async () => {
  const t = mapClosedPositions([row])[0];
  const query=jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{
    quantity:99,pnl:t.pnl,entry_time:t.entryTime,exit_time:t.exitTime,symbol:t.symbol,executions:t.executions }]});
  db.withTransaction.mockImplementation(fn=>fn({query}));
  await expect(importClosedPositions({id:'c',userId:'u',externalAccountId:'123'},
    {'Closed Positions':[row]})).rejects.toThrow('overlapping');
  expect(query).toHaveBeenCalledTimes(2);
});
