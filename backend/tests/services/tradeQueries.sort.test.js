jest.mock('../../src/config/database', () => ({query: jest.fn(async sql => ({rows: sql.includes('information_schema') ? [{column_name:'id'}] : []}))}));
const db = require('../../src/config/database');
const TradeQueries = require('../../src/services/tradeQueries');
const {tradeListSort} = require('../../src/utils/tradeListSort');
beforeEach(()=>db.query.mockClear());

test('sorting applies before pagination and preserves the same order outside the page subquery', async () => {
  await TradeQueries.findByUser('user-test', {sortBy:'pnl',sortDirection:'asc',limit:20,offset:20,accounts:['account-test']});
  const [sql, values] = db.query.mock.calls.find(([sql])=>sql.includes('FROM (SELECT t.id'));
  expect(sql.indexOf('ORDER BY sort_value ASC NULLS LAST, t.id DESC')).toBeLessThan(sql.indexOf('LIMIT $'));
  expect(sql).toContain('ORDER BY trade_ids.sort_value ASC NULLS LAST, t.id DESC');
  expect(sql).toContain('trade_amount_usd(t.pnl');
  expect(values).toContain(20);
  expect(values).toContain('account-test');
});

test('missing values remain last in either direction and default is newest entry first',()=>{
  expect(tradeListSort()).toEqual({expression:'t.entry_time',direction:'DESC'});
  expect(tradeListSort('symbol','asc').direction).toBe('ASC');
});

test.each([['symbol; DROP TABLE trades','asc'],['pnl','desc; DROP TABLE trades'],['toString','asc']])('rejects untrusted SQL sorting inputs %s', (column,direction)=>{
  expect(()=>tradeListSort(column,direction)).toThrow('Invalid trade sort');
});

test('sector sorting binds cached crypto labels before pagination parameters', async()=>{
  await TradeQueries.findByUser('user-test',{sortBy:'sector',sortDirection:'desc',limit:10});
  const [sql,values] = db.query.mock.calls.find(([sql])=>sql.includes('FROM (SELECT t.id'));
  expect(sql).toContain("t.instrument_type='crypto'");
  expect(sql).toContain('$2::jsonb ->> t.symbol');
  expect(sql).toContain('LIMIT $3');
  expect(values).toEqual(['user-test','{}',10]);
});
