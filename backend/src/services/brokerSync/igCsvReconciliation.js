const db = require('../../config/database');
const {csv, cents, prepare} = require('./igStatement');
const {signature} = require('./igEmailCash');
const {localToUTC} = require('../../utils/timezone');
const reject = message => { throw Error(`IG upload: ${message}`); };

function mergeTransactions(previous, incoming) {
  const old = csv(previous, 'TextDate'), added = csv(incoming, 'TextDate');
  if (!old.length || !added.length) reject('The Transactions CSV must contain account activity.');
  const columns = Object.keys(old[0]);
  if (added.some(row => Object.keys(row).sort().join('|') !== [...columns].sort().join('|')))
    reject('The Transactions CSV columns do not match the saved export.');
  const rows = new Map(old.map(row => [row.Reference, row])), seen = new Set();
  for (const row of added) {
    if (!row.Reference || seen.has(row.Reference)) reject('The Transactions CSV contains duplicate references.');
    seen.add(row.Reference);
    const prior = rows.get(row.Reference);
    if (prior && columns.some(key => String(prior[key]).trim() !== String(row[key]).trim()))
      reject('An existing transaction changed. Upload the full reports for review.');
    rows.set(row.Reference, row);
  }
  const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  return [columns, ...[...rows.values()].sort((a,b) => a.DateUtc.localeCompare(b.DateUtc) || a.Reference.localeCompare(b.Reference)).map(row => columns.map(key => row[key]))]
    .map(row => row.map(cell).join(',')).join('\n');
}

async function reconcile(userId, original, incoming) {
  if (original.kind !== 'share_dealing') reject('CSV-only reconciliation is available for share-dealing accounts.');
  const identifier = prepare(original).identifier;
  const points = (await db.query(`SELECT evidence FROM ig_statement_ingestion
    WHERE user_id=$1 AND account_identifier=$2 AND status='imported'
    ORDER BY statement_date`, [userId, identifier])).rows.map(row => row.evidence).filter(p => p?.date && p?.positions);
  const updated = {...original, transactions:mergeTransactions(original.transactions, incoming)};
  const events = new Map((original.emailCashRecords || []).map(r => [r.reference, r]));
  for (const point of points) if (point.activitySupported) for (const event of point.records || []) {
    const prior = events.get(event.reference);
    if (prior && signature(prior) !== signature(event)) reject('Saved statement cash evidence conflicts. Review the statements.');
    events.set(event.reference, event);
  }
  updated.emailCashRecords = [...events.values()];
  const latest = points.at(-1);
  if (latest && latest.date >= original.confirmation.cutoff.slice(0,10)) {
    const known = original.confirmation.holdings;
    if (latest.positions.length !== known.length || latest.positions.some(p => !known.some(h => h.isin === p.isin && h.quantity === p.quantity && cents(h.cost) === cents(p.cost))))
      reject('Holdings changed. Include the execution and balance PDFs with the full reports.');
    updated.confirmation = {...original.confirmation, cash:latest.cash, holdings:latest.positions,
      cutoff:new Date(localToUTC(latest.date+'T23:59:59','Europe/London')).toISOString()};
  }
  // The native ledger must reconcile to dated evidence; never create a balancing entry.
  try { prepare(updated); } catch (error) {
    if (error.message.includes('cash history does not reconcile'))
      reject('Transactions do not reconcile with the saved statement. Export full history through the statement date, including activity before this export’s range.');
    throw error;
  }
  return updated;
}
module.exports = {mergeTransactions, reconcile};
