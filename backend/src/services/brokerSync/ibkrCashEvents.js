const db = require('../../config/database');
const converter = require('../../utils/currencyConverter');

function field(row, ...names) {
  const normalized = Object.fromEntries(Object.entries(row).map(([k,v]) => [k.toLowerCase().replace(/[^a-z0-9]/g,''),v]));
  for (const name of names) {
    const value = normalized[name.toLowerCase().replace(/[^a-z0-9]/g,'')];
    if (value !== undefined && value !== '') return String(value).trim();
  }
  return '';
}

function cashEvent(row, isFunds) {
  const code = field(row, isFunds ? 'activityCode' : 'type').toUpperCase();
  const codes = {DEP:'deposit', WITH:'withdrawal', DIV:'dividend', PIL:'dividend',
    CINT:'interest',DINT:'interest',INTP:'interest',INTR:'interest',
    OFEE:'account_fee',MFEE:'account_fee',FRTAX:'tax',STAX:'tax'};
  const names = {'DEPOSITS/WITHDRAWALS':'funding',DEPOSIT:'deposit',WITHDRAWAL:'withdrawal',
    DIVIDENDS:'dividend','PAYMENT IN LIEU OF DIVIDENDS':'dividend',
    'BROKER INTEREST PAID':'interest','BROKER INTEREST RECEIVED':'interest',
    'BOND INTEREST PAID':'interest','BOND INTEREST RECEIVED':'interest',
    'OTHER FEES':'account_fee','WITHHOLDING TAX':'tax','SALES TAX':'tax'};
  let type = isFunds ? codes[code] : names[code];
  if (!type) return null; // Trades, FX conversions and accruals are not extra cash income.
  const rawAmount = field(row,'amount');
  const amount = rawAmount ? Number(rawAmount) : Number(field(row,'credit') || 0) - Math.abs(Number(field(row,'debit') || 0));
  if (type === 'funding') type = amount >= 0 ? 'deposit' : 'withdrawal';
  const rawDate = field(row,'date','dateTime','reportDate').split(/[;T ]/)[0];
  const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6)}` : rawDate;
  const currency = field(row,'currency').toUpperCase();
  const account = field(row,'accountId','account');
  const reference = field(row,'transactionID');
  if (!Number.isFinite(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || !/^[A-Z]{3}$/.test(currency) || !account || !reference) {
    throw new Error('IBKR cash row needs a valid account, transaction ID, date, currency and amount; select all Statement of Funds fields.');
  }
  return {type,amount,date,currency,account,reference,fxRateToBase:Number(field(row,'fxRateToBase')) || null,description:field(row,'activityDescription','description')};
}

async function importCashEvents(connection, sections, range = {}) {
  const funds = sections.statement_of_funds || [];
  // Statement of Funds is the authoritative cash ledger. Cash Transactions is
  // a fallback only for accounts absent from that ledger, never an extra total.
  const covered = new Set(funds.map(row => field(row,'accountId','account')));
  const inputs = [...funds.map(row => [row,true]), ...(sections.cash_transactions || [])
    .filter(row => !covered.has(field(row,'accountId','account'))).map(row => [row,false])];
  const warnings = [];
  const events = new Map();
  for (const [row,isFunds] of inputs) {
    if (/summary|total/i.test(field(row,'levelOfDetail'))) continue;
    try {
      const cashRow = (sections.cash_transactions || []).find(c => field(c,'accountId','account') === field(row,'accountId','account') && field(c,'transactionID') === field(row,'transactionID'));
      const event = cashEvent({...row,fxRateToBase:field(row,'fxRateToBase') || field(cashRow || {},'fxRateToBase')},isFunds);
      if (!event || (range.startDate && event.date < range.startDate) || (range.endDate && event.date > range.endDate)) continue;
      const key = `${event.account}:${event.reference}`;
      if (events.has(key) && JSON.stringify(events.get(key)) !== JSON.stringify(event)) throw new Error('Conflicting IBKR cash transaction IDs; cash import aborted.');
      events.set(key,event);
    } catch (error) { warnings.push(error.message); }
  }
  if (warnings.length) return {imported:0,matched:0,warnings:[...new Set(warnings)]};
  if (!events.size) return {imported:0,matched:0,warnings:[],rows:0};
  const accounts = (await db.query('SELECT id,account_identifier,broker,currency FROM user_accounts WHERE user_id=$1',[connection.userId])).rows;
  const prepared = [];
  for (const event of events.values()) {
    const masked = `****${event.account.slice(-4)}`;
    const matches = accounts.filter(a => ['ibkr','interactive brokers','interactivebrokers'].includes(String(a.broker || '').toLowerCase()) &&
      [event.account,masked].includes(a.account_identifier));
    if (matches.length !== 1) { warnings.push('IBKR cash events could not match exactly one managed IBKR account. Check its account identifier.'); continue; }
    // The managed account currency represents the broker's base currency.
    // For USD base accounts prefer the actual statement FX rate over an estimate.
    const converted = matches[0].currency === 'USD' && event.fxRateToBase > 0
      ? {amountUSD:event.amount * event.fxRateToBase,exchangeRate:event.fxRateToBase}
      : await converter.convertToUSD(event.amount,event.currency,event.date);
    if (!Number.isFinite(converted.amountUSD) || !(converted.exchangeRate > 0)) throw new Error('Invalid IBKR cash conversion');
    prepared.push({...event,accountId:matches[0].id,usd:converted.amountUSD});
  }
  const counts = await db.withTransaction(async client => {
    let imported = 0, matched = 0;
    for (const e of prepared) {
      const result = await client.query(`INSERT INTO broker_cash_events(user_id,account_id,broker_type,reference_id,event_type,event_date,amount,currency,amount_usd,description)
        VALUES($1,$2,'ibkr',$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(user_id,account_id,broker_type,reference_id) DO UPDATE
        SET event_type=EXCLUDED.event_type,event_date=EXCLUDED.event_date,amount=EXCLUDED.amount,currency=EXCLUDED.currency,
            amount_usd=EXCLUDED.amount_usd,description=EXCLUDED.description,updated_at=NOW()
        RETURNING (xmax=0) AS inserted`,[connection.userId,e.accountId,e.reference,e.type,e.date,e.amount,e.currency,e.usd,e.description]);
      if (result.rows[0].inserted) imported++; else matched++;
    }
    return {imported,matched};
  });
  return {...counts,warnings:[...new Set(warnings)],rows:events.size};
}
module.exports = {cashEvent,importCashEvents};
