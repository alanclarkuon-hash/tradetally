jest.mock('../../src/config/database', () => ({ withTransaction: jest.fn() }));
jest.mock('../../src/services/analyticsCache', () => ({ invalidate: jest.fn() }));
const db = require('../../src/config/database');
const { mapSnapshot, plan, reconcile, cashSnapshot } = require('../../src/services/brokerSync/etoroReconcile');

const open = { positionID: 1, instrumentID: 100, units: 2, initialUnits: 10,
  initialAmountInDollars: 1000, leverage: 1, isBuy: true, openRate: 80,
  openConversionRate: 1.25, unitsBaseValueDollars: 200, openDateTime: '2022-01-01T10:00:00Z',
  orderID: 10, unrealizedPnL: { closeRate: 90, closeConversionRate: 1.3 } };
const closed = { positionId: 2, instrumentId: 200, units: 0.1, leverage: 1, isBuy: true,
  openRate: 100, closeRate: 120, investment: 10, initialInvestment: 10, netProfit: 2, fees: 0.5,
  openTimestamp: '2025-01-01T10:00:00Z', closeTimestamp: '2026-01-01T10:00:00Z', orderId: 20 };
function payload() { return { portfolio: {credit:500,bonusCredit:25}, positions: [open], history: [closed],
  instruments: [{ instrumentID: 100, symbolFull: 'SYNTH.L', instrumentTypeID: 1 },
    { instrumentID: 200, symbolFull: 'SYNTHCOIN', instrumentTypeID: 2 }],
  instrumentTypes: [{ instrumentTypeID: 1, instrumentTypeDescription: 'Stocks' },
    { instrumentTypeID: 2, instrumentTypeDescription: 'Crypto' }] }; }

test('uses remaining cost and broker FX rather than the initial investment after a partial sale', () => {
  const result = mapSnapshot(payload());
  expect(result.trades[0]).toMatchObject({ quantity: 2, entryPrice: 100, symbol: 'SYNTH.L' });
  expect(result.positions[0]).toMatchObject({ quantity: 2, totalCost: 200, currentValue: 234 });
});
test('keeps crypto net profit without subtracting informational fees a second time', () => {
  const trade = mapSnapshot(payload()).trades[1];
  expect(trade).toMatchObject({ instrumentType: 'crypto', quantity: 0.1, pnl: 2, fees: 0.5 });
  expect(trade.executions[1].realized_pnl).toBe(2);
});
test('combines multiple lots into one authoritative portfolio holding', () => {
  const p = payload(); p.positions.push({ ...open, positionID: 3 });
  const mapped = mapSnapshot(p);
  expect(mapped.trades).toHaveLength(3);
  expect(mapped.positions).toHaveLength(1);
  expect(mapped.positions[0]).toMatchObject({ lotCount: 2, quantity: 4, totalCost: 400, currentValue: 468 });
});
test.each(['fx', 'leverage', 'cost', 'profit'])('stops an unverified %s mapping', reason => {
  const p = payload();
  if (reason === 'fx') p.history = [{ ...closed, investment: 12 }];
  if (reason === 'leverage') p.positions = [{ ...open, leverage: 2 }];
  if (reason === 'cost') p.positions = [{ ...open, unitsBaseValueDollars: 1000 }];
  if (reason === 'profit') p.history = [{ ...closed, netProfit: 100 }];
  expect(() => mapSnapshot(p)).toThrow();
});
function existing(trade, id = 'old') { return { id, exit_time: trade.exitTime, executions: trade.executions }; }
test('preserves IDs on repeat sync and on a full closure', () => {
  const t = mapSnapshot(payload()).trades;
  expect(plan(t, t.map((r, i) => existing(r, `old-${i}`))).map(r => r.old.id)).toEqual(['old-0','old-1']);
  const oldOpen = existing({ exitTime: null, executions: [{ etoro_record_key: 'open:2', etoro_position_id: '2' }] });
  expect(plan([t[1]], [oldOpen])[0].old.id).toBe('old');
});
test('later API sync reuses an imported statement trade despite timestamp precision', () => {
  const t = mapSnapshot(payload()).trades[1];
  const old = { id: 'historical', quantity: t.quantity, pnl: t.pnl,
    entry_time: t.entryTime, exit_time: t.exitTime,
    executions: [{ etoro_position_id: t.positionId, etoro_record_key: `statement:${t.positionId}`,
      etoro_statement_source: true }] };
  expect(plan([t],[old])[0].old.id).toBe('historical');
});
test('a partial closure does not consume the remaining open lot or drop earlier closed history', () => {
  const t = mapSnapshot(payload()).trades;
  const partial = { ...t[1], positionId: '1' };
  const oldOpen = existing(t[0]);
  const previousClosed = existing(t[1], 'prior');
  const plans = plan([t[0], partial], [oldOpen, previousClosed]);
  expect(plans[0].old).toBe(oldOpen);
  expect(() => plan([], [oldOpen])).toThrow('disappeared');
  expect(plan([], [previousClosed])).toEqual([]);
});
test('import writes owner-scoped trades and holdings in one transaction; dry-run does not write', async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  db.withTransaction.mockImplementation(fn => fn({ query }));
  const connection = { id: 'connection', userId: 'owner', externalAccountId: '123' };
  expect(await reconcile(connection, payload(), { dryRun: true })).toMatchObject({ imported: 2 });
  expect(query.mock.calls).toHaveLength(2);
  query.mockClear();
  await reconcile(connection, payload());
  expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO trades'))).toHaveLength(2);
  const [sql, args] = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO broker_portfolio_snapshots'));
  expect(sql).toContain("'etoro'");
  expect(args.slice(0,3)).toEqual(['owner','eToro ****123','connection']);
  const metadata=query.mock.calls.find(([sql])=>sql.includes('UPDATE broker_connections'))[1];
  expect(JSON.parse(metadata[2]).cash_balance).toMatchObject({amount:500,currency:'USD',accountIdentifier:'eToro ****123'});
});
test('cash uses real USD credit, supports zero, and excludes bonus credit and reserved orders',()=>{
  expect(cashSnapshot({Credit:0,bonusCredit:99,orders:[{amount:10}]},'account')).toMatchObject({amount:0,currency:'USD'});
  expect(cashSnapshot({credit:'125.50',bonusCredit:99},'account').amount).toBe(125.5);
  for(const credit of [null,undefined,'',true,'invalid']) expect(()=>cashSnapshot({credit},'account')).toThrow();
});
