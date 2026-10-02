const {parse} = require('csv-parse/sync');
const db = require('../../config/database');
const converter = require('../../utils/currencyConverter');

// CSV notes explain some transactions which the JSON API labels as funding.
// Only annotate existing API identities; never create a balancing payment.
function statementAnnotations(csv) {
  const rows = parse(csv, {columns:true, skip_empty_lines:true, bom:true});
  const reservations = new Map();
  const annotations = new Map();
  const identities = new Map();
  for (const row of rows.sort((a,b)=>a['Time (UTC)'].localeCompare(b['Time (UTC)']))) {
    const notes = row.Notes || '';
    const blocked = notes.match(/^blocked for rights issue \(([^)]+)\)$/i);
    const executed = notes.match(/^rights issue executed \(([^)]+)\)$/i);
    let type, amount = Number(row.Total);
    if (row.Action === 'Dividend adjustment') type = 'dividend';
    else if (row.Action === 'Result adjustment' && /proceeds from sale of .* rights/i.test(notes)) type = 'corporate_action';
    else if (row.Action === 'Withdrawal' && blocked) type = 'corporate_action';
    else if (row.Action === 'Deposit' && executed) type = 'corporate_action';
    else continue;
    const fingerprint = JSON.stringify(row);
    if (identities.has(row.ID)) {
      if (identities.get(row.ID) !== fingerprint) throw new Error('Conflicting statement annotation');
      continue;
    }
    identities.set(row.ID,fingerprint);
    const timestamp = Date.parse(row['Time (UTC)']);
    const currency = row['Currency (Total)'];
    if (!row.ID || row.Total === '' || !Number.isFinite(amount) || !Number.isFinite(timestamp) || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Invalid Trading 212 statement annotation');
    }
    const originalAmount = amount;
    const key = `${currency}:${(blocked || executed)?.[1]}:${Math.abs(amount)}`;
    if (blocked) {
      if (!(amount < 0)) throw new Error('Invalid rights reservation');
      reservations.set(key, (reservations.get(key) || 0) + 1);
    }
    if (executed) {
      if (!(amount > 0) || !reservations.get(key)) throw new Error('Rights execution lacks matching reserved cash');
      reservations.set(key, reservations.get(key) - 1);
      // The reservation already removed this cash. Execution consumes it,
      // rather than returning it to the wallet as the API's DEPOSIT suggests.
      amount = 0;
    }
    const event = {reference:`transactions:${row.ID}`, date:new Date(timestamp).toISOString().slice(0,10),
      currency, originalAmount, amount, type, description:`${row.Action}: ${notes}`};
    const previous = annotations.get(event.reference);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('Conflicting statement annotation');
    annotations.set(event.reference,event);
  }
  return [...annotations.values()];
}

async function importStatementAnnotations(connection, csv) {
  const id = String(connection.externalAccountId || '');
  const accounts = (await db.query(`SELECT id,currency FROM user_accounts WHERE user_id=$1 AND broker='trading212'
    AND account_identifier IN ($2,$3)`,[connection.userId,id,`****${id.slice(-4)}`])).rows;
  if (!id || accounts.length !== 1) throw new Error('Statement needs one matching Trading 212 account');
  const annotations = statementAnnotations(csv);
  return db.withTransaction(async client => {
    for (const event of annotations) {
      if (event.currency !== accounts[0].currency) throw new Error('Statement annotation currency mismatch');
      const converted = await converter.convertToUSD(event.amount,event.currency,event.date);
      if (!Number.isFinite(converted.amountUSD) || !(converted.exchangeRate > 0)) throw new Error('Invalid annotation conversion');
      const result = await client.query(`UPDATE broker_cash_events SET event_type=$4,amount=$5,amount_usd=$6,
        description=$7,metadata=metadata || jsonb_build_object('statement_annotation',jsonb_build_object('apiAmount',$8::numeric)),updated_at=NOW()
        WHERE user_id=$1 AND account_id=$2 AND broker_type='trading212' AND reference_id=$3
          AND currency=$9 AND event_date=$10
          AND COALESCE((metadata->'statement_annotation'->>'apiAmount')::numeric,amount)=$8
        RETURNING id`,[connection.userId,accounts[0].id,event.reference,event.type,event.amount,converted.amountUSD,
        event.description,event.originalAmount,event.currency,event.date]);
      if (result.rows.length !== 1) throw new Error('Statement annotation does not match imported API payment');
    }
    return {annotated:annotations.length};
  });
}

module.exports = {statementAnnotations,importStatementAnnotations};
