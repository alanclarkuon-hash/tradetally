const db = require('../../config/database');
const converter = require('../../utils/currencyConverter');

function cashEvent(row, section) {
  const amount = Number(row.amount);
  const timestamp = section === 'dividends' ? row.paidOn : row.dateTime;
  const date = String(timestamp || '').slice(0, 10);
  const currency = String(row.currency || '').toUpperCase();
  if (row.amount == null || !Number.isFinite(amount) || !row.reference ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(timestamp)) ||
      !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid Trading 212 cash record');
  const types = {DEPOSIT:'deposit',WITHDRAW:'withdrawal',FEE:'account_fee',
    INTEREST_ON_FREE_CASH:'interest',LENDING_INTEREST:'interest'};
  const type = section === 'dividends' ? 'dividend' : row.type === 'TRANSFER'
    ? (amount >= 0 ? 'deposit' : 'withdrawal') : types[row.type];
  if (!type) throw new Error(`Unsupported Trading 212 cash type: ${row.type}`);
  // The API amount is the actual net wallet payment. Gross per-share values
  // and amountInEuro are context, never additional income or separate tax.
  return {type, amount, date, currency, reference:`${section}:${row.reference}`,
    description:section === 'dividends' ? `${row.type}: ${row.instrument?.ticker || row.ticker || ''}` : row.type};
}

async function importCashEvents(connection, sections) {
  if (!connection.externalAccountId) throw new Error('Trading 212 account identity is missing');
  const identifier = String(connection.externalAccountId);
  const accounts = (await db.query(`SELECT id FROM user_accounts WHERE user_id=$1
    AND broker='trading212' AND account_identifier IN ($2,$3)`,
  [connection.userId,identifier,`****${identifier.slice(-4)}`])).rows;
  if (accounts.length !== 1) throw new Error('Trading 212 cash history requires exactly one matching managed account');
  const events = new Map();
  for (const section of ['transactions','dividends']) {
    if (!Array.isArray(sections[section])) throw new Error('Incomplete Trading 212 cash history');
    for (const row of sections[section]) {
      const event = cashEvent(row,section);
      const previous = events.get(event.reference);
      if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('Conflicting Trading 212 cash references');
      events.set(event.reference,event);
    }
  }
  const prepared = [];
  for (const event of events.values()) {
    const converted = await converter.convertToUSD(event.amount,event.currency,event.date);
    if (!Number.isFinite(converted.amountUSD) || !(converted.exchangeRate > 0)) throw new Error('Invalid Trading 212 cash conversion');
    prepared.push({...event,usd:converted.amountUSD});
  }
  return db.withTransaction(async client => {
    let imported=0,matched=0;
    for (const e of prepared) {
      const result = await client.query(`INSERT INTO broker_cash_events
        (user_id,account_id,broker_type,reference_id,event_type,event_date,amount,currency,amount_usd,description)
        VALUES($1,$2,'trading212',$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(user_id,account_id,broker_type,reference_id) DO UPDATE SET
        event_type=EXCLUDED.event_type,event_date=EXCLUDED.event_date,amount=EXCLUDED.amount,
        currency=EXCLUDED.currency,amount_usd=EXCLUDED.amount_usd,description=EXCLUDED.description,updated_at=NOW()
        RETURNING (xmax=0) AS inserted`,
      [connection.userId,accounts[0].id,e.reference,e.type,e.date,e.amount,e.currency,e.usd,e.description]);
      if(result.rows[0].inserted) imported++; else matched++;
    }
    return {imported,matched,rows:prepared.length};
  });
}
module.exports = {cashEvent,importCashEvents};
