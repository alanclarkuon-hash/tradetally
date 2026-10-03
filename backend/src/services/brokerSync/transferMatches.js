const db = require('../../config/database');
const {decimal, format, assetCode} = require('./krakenReconcile');
const FIAT = new Set(['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'CHF', 'JPY']);
const identity = leg => JSON.stringify([leg.broker, leg.account, leg.reference]);

// Only native external transfers with known fee conventions are supported.
// OKX Funding/Trading wallet bills and eToro USD/GBP cash conversions are
// deliberately excluded: they do not establish an external crypto movement.
function extract(snapshots) {
  const legs = [];
  for (const {broker_type: broker, account_identifier: account, payload} of snapshots) {
    if (broker === 'kraken') {
      for (const [reference, row] of Object.entries(payload.ledger || {})) {
        if (!['deposit', 'withdrawal'].includes(row.type)) continue;
        const asset = assetCode(row.asset);
        if (FIAT.has(asset)) continue;
        const amount = decimal(row.amount), fee = decimal(row.fee || '0');
        const direction = row.type === 'deposit' ? 'in' : 'out';
        if (fee < 0n || (direction === 'in' ? amount <= fee : amount >= 0n)) continue;
        const quantity = direction === 'in' ? amount - fee : -amount;
        legs.push({broker, account, reference, asset, direction,
          quantity: format(quantity), fee: format(fee), time: Number(row.time) * 1000});
      }
    } else if (broker === 'okx') {
      for (const row of payload.deposits || []) {
        if (String(row.state) !== '2' || !row.depId || FIAT.has(row.ccy)) continue;
        const quantity = decimal(row.amt);
        if (quantity <= 0n) continue;
        legs.push({broker, account, reference: String(row.depId), asset: row.ccy,
          direction: 'in', quantity: format(quantity), fee: '0', time: Number(row.ts)});
      }
    }
  }
  const keys = new Set();
  for (const leg of legs) {
    const key = identity(leg);
    if (keys.has(key) || !Number.isFinite(leg.time) || !Number.isFinite(new Date(leg.time).getTime())) {
      throw Error('Invalid or duplicated external transfer record');
    }
    keys.add(key);
  }
  return legs;
}

function pair(legs) {
  const outs = legs.filter(l => l.direction === 'out'), ins = legs.filter(l => l.direction === 'in');
  const compatible = (out, incoming) => out.broker !== incoming.broker &&
    out.asset === incoming.asset && out.quantity === incoming.quantity &&
    incoming.time - out.time >= -60000 && incoming.time - out.time <= 15 * 60000;
  const candidates = outs.map(out => ({out, incoming: ins.filter(l => compatible(out, l))}));
  // Require uniqueness on BOTH legs, including candidates competing with an
  // ambiguous withdrawal. Never greedily choose the nearest amount/time.
  return candidates.filter(c => c.incoming.length === 1 &&
    candidates.filter(other => other.incoming.some(l => identity(l) === identity(c.incoming[0]))).length === 1)
    .map(c => ({out: c.out, incoming: c.incoming[0]}));
}

async function save(userId) {
  return db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`transfer-matches:${userId}`]);
    const snapshots = (await client.query(`SELECT broker_type,account_identifier,payload
      FROM broker_import_snapshots WHERE user_id=$1 AND broker_type IN ('kraken','okx')`, [userId])).rows;
    const legs = extract(snapshots);
    const existing = (await client.query('SELECT * FROM broker_transfer_matches WHERE user_id=$1', [userId])).rows;
    const occupied = new Set();
    for (const row of existing) {
      for (const [side, direction] of [['source', 'out'], ['destination', 'in']]) {
        const key = identity({broker: row[`${side}_broker`], account: row[`${side}_account`], reference: row[`${side}_reference`]});
        occupied.add(key);
        const current = legs.find(l => identity(l) === key);
        if (current && (current.direction !== direction || current.asset !== row.asset ||
          decimal(current.quantity) !== decimal(row.quantity) ||
          current.time !== new Date(row[side === 'source' ? 'sent_at' : 'received_at']).getTime() ||
          (side === 'source' && decimal(current.fee) !== decimal(row.source_fee)))) {
          throw Error('A previously linked transfer changed; review required');
        }
      }
    }
    // Determine ambiguity before removing occupied records, so a newer record
    // cannot turn an ambiguous amount into an apparently unique match.
    const matches = pair(legs).filter(({out, incoming}) => !occupied.has(identity(out)) && !occupied.has(identity(incoming)));
    for (const {out, incoming} of matches) {
      await client.query(`INSERT INTO broker_transfer_matches(user_id,source_broker,source_account,source_reference,
        destination_broker,destination_account,destination_reference,asset,quantity,source_fee,sent_at,received_at,match_method)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'unique_amount_time')`,
      [userId,out.broker,out.account,out.reference,incoming.broker,incoming.account,incoming.reference,
        out.asset,out.quantity,out.fee,new Date(out.time),new Date(incoming.time)]);
    }
    return {created: matches.length, total: existing.length + matches.length};
  });
}

async function list(userId) {
  const snapshots = (await db.query(`SELECT broker_type,account_identifier,payload FROM broker_import_snapshots
    WHERE user_id=$1 AND broker_type IN ('kraken','okx')`, [userId])).rows;
  const stored = (await db.query(`SELECT id,source_broker,source_account,source_reference,destination_broker,
    destination_account,destination_reference,asset,quantity,source_fee,sent_at,received_at,match_method
    FROM broker_transfer_matches WHERE user_id=$1 ORDER BY sent_at DESC`, [userId])).rows;
  const occupied = new Set(stored.flatMap(row => ['source','destination'].map(side => identity({
    broker: row[`${side}_broker`],account: row[`${side}_account`],reference: row[`${side}_reference`]}))));
  // Return no raw payloads, addresses, blockchain hashes or credentials.
  return {matches: stored.map(({source_reference,destination_reference,source_account,destination_account,...row}) => row),
    unmatched: extract(snapshots).filter(l => !occupied.has(identity(l))).map(({broker,asset,direction,quantity,fee,time}) =>
      ({broker,asset,direction,quantity,fee,date:new Date(time).toISOString()})),
    notice: 'These links identify movements between your own accounts. They create no deposits or income and do not change original acquisition cost. eToro crypto transfers need a wallet history; USD/GBP statement transfers are cash conversions.'};
}
module.exports = {extract, pair, save, list};
