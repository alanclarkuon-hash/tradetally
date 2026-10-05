const db = require('../../src/config/database');
const { fxUsdFromSnapshot, withUsdRateSnapshot } = require('../../src/utils/tradeFx');
test('one rate snapshot preserves the SQL function for nulls, conversion markers and native currencies', async () => {
  const sql = withUsdRateSnapshot(`SELECT
    trade_amount_usd(t.amount, t.original_currency, t.exchange_rate, t.original_entry_price_currency) AS before,
    ${fxUsdFromSnapshot('amount')} AS after
    FROM (VALUES
      (NULL::numeric,'GBP',1::numeric,NULL::numeric),
      (100::numeric,'GBP',1::numeric,80::numeric),
      (100::numeric,'USD',NULL::numeric,NULL::numeric),
      (-100::numeric,'gbp',1::numeric,NULL::numeric),
      (100::numeric,NULL::text,NULL::numeric,NULL::numeric),
      (100::numeric,''::text,NULL::numeric,NULL::numeric),
      (100::numeric,'UNKNOWN',NULL::numeric,NULL::numeric)
    ) t(amount, original_currency, exchange_rate, original_entry_price_currency)`);
  const {rows} = await db.query(sql);
  for (const row of rows) expect(row.after).toEqual(row.before);
});
