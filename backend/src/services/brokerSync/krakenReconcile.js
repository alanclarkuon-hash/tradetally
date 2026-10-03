// Native reconciliation is deliberately independent of prices and reporting.
// Keep all arithmetic in decimal integers: crypto dust must not disappear when
// thousands of ledger movements are summed using floating point arithmetic.
const SCALE = 16;
const UNIT = 10n ** BigInt(SCALE);
function decimal(value) {
  const text = String(value ?? '');
  const match = text.match(/^(-?)(\d+)(?:\.(\d{1,16}))?$/);
  if (!match) throw new Error('Invalid Kraken decimal amount');
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * UNIT + BigInt((match[3] || '').padEnd(SCALE, '0')));
}
function format(value) {
  const sign = value < 0n ? '-' : '';
  const n = value < 0n ? -value : value;
  const fraction = (n % UNIT).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${sign}${n / UNIT}${fraction ? '.' + fraction : ''}`;
}
function precisionUnit(value) {
  const fraction = String(value).split('.')[1] || '';
  return 10n ** BigInt(SCALE - fraction.length);
}
const ALIASES = {XXBT:'BTC',XBT:'BTC',XETH:'ETH',XXDG:'DOGE',XDG:'DOGE',XLTC:'LTC',XXRP:'XRP',XXLM:'XLM',
  ZGBP:'GBP',ZUSD:'USD',ZEUR:'EUR',ZCAD:'CAD',ZJPY:'JPY',ZAUD:'AUD',ZCHF:'CHF'};
function nativeWalletCode(asset) {
  // BalanceEx and Ledgers can use different aliases for the same wallet.
  // Preserve wallet suffixes and bonded terms: spot and Earn are distinct.
  return String(asset).replace(/^([^.]+)(.*)$/, (_,base,suffix)=>(ALIASES[base] || base)+suffix);
}
function assetCode(asset) {
  let code = String(asset);
  // These suffixes denote overlapping staking/earn wallets, not new assets.
  if (/\.(S|B|F|M)$/.test(code)) {
    code = code.replace(/\.(S|B|F|M)$/, '');
    if (/^(DOT28|SOL03|KSM07|ATOM21|GRT28|MATIC04)$/.test(code)) code = code.replace(/\d+$/, '');
    if (code === 'ETH2') code = 'ETH';
  }
  return ALIASES[code] || code;
}
const FIAT = new Set(['GBP','USD','EUR','CAD','JPY','AUD','CHF']);
function category(row) {
  if (row.type === 'staking') return 'staking_reward';
  if (['deposit','withdrawal'].includes(row.type)) return FIAT.has(assetCode(row.asset)) ? row.type : 'external_crypto_transfer';
  if (['spend','receive'].includes(row.type)) return 'conversion';
  if (['margin','rollover','settled'].includes(row.type)) return 'margin_settlement';
  if (row.type === 'trade') return 'spot_settlement';
  if (row.type === 'transfer') return ['autoallocation','spottostaking','stakingtospot'].includes(row.subtype)
    ? 'staking_transfer' : 'asset_conversion';
  return 'unsupported';
}
function audit(payload) {
  if (!payload?.historyDownloaded || !payload.balances || !payload.ledger || !payload.trades ||
      !Array.isArray(payload.allocations?.items)) throw new Error('Incomplete Kraken snapshot');
  const assets = new Map(), counts = {}, rewards = new Map(), settlements = new Map(), blockers = [];
  const balances = new Map();
  for (const [asset,value] of Object.entries(payload.balances)) {
    const wallet = nativeWalletCode(asset);
    if (balances.has(wallet)) blockers.push(`Duplicate native balance aliases: ${assetCode(asset)}`);
    else balances.set(wallet,value);
  }
  for (const [id, row] of Object.entries(payload.ledger)) {
    if (!id || !row.asset || !Number.isFinite(Number(row.time))) throw new Error('Invalid Kraken ledger identity');
    const amount = decimal(row.amount), fee = decimal(row.fee);
    if (fee < 0n) throw new Error('Unexpected negative Kraken ledger fee');
    const wallet = nativeWalletCode(row.asset);
    const entry = assets.get(wallet) || {net:0n,unit:1n,lastTime:-Infinity,lastBalance:0n};
    entry.net += amount - fee;
    entry.unit = entry.unit > precisionUnit(row.amount) ? entry.unit : precisionUnit(row.amount);
    if (row.time >= entry.lastTime) {entry.lastTime = row.time; entry.lastBalance = decimal(row.balance);}
    assets.set(wallet, entry);
    const kind = category(row); counts[kind] = (counts[kind] || 0) + 1;
    if (kind === 'unsupported') blockers.push('Unsupported ledger activity');
    if (kind === 'staking_reward') {
      const code = assetCode(row.asset), reward = rewards.get(code) || {gross:0n,fees:0n,net:0n,count:0};
      reward.gross += amount; reward.fees += fee; reward.net += amount-fee; reward.count++;
      rewards.set(code,reward);
    }
    if (kind === 'spot_settlement') {
      if (!row.refid) throw new Error('Missing Kraken settlement reference');
      const group = settlements.get(row.refid) || [];
      group.push({id,...row}); settlements.set(row.refid,group);
    }
  }
  const nativeBalances = [];
  for (const asset of new Set([...assets.keys(),...balances.keys()])) {
    const entry = assets.get(asset), reportedText = balances.get(asset)?.balance || '0';
    const reported = decimal(reportedText), calculated = entry?.net || 0n;
    const difference = calculated - reported;
    // Historical fills can leave one native precision unit of rounding; the
    // authoritative final ledger balance must still equal BalanceEx exactly.
    const tolerance = entry?.unit || precisionUnit(reportedText);
    const finalMatches = (entry?.lastBalance || 0n) === reported;
    const matched = finalMatches && (difference < 0n ? -difference : difference) <= tolerance;
    if (!matched) blockers.push(`Native balance mismatch: ${assetCode(asset)}`);
    nativeBalances.push({asset,symbol:assetCode(asset),reported:format(reported),calculated:format(calculated),
      difference:format(difference),matched,holdTrade:format(decimal(balances.get(asset)?.hold_trade || '0'))});
  }
  const normalizedBalances = new Map();
  for (const row of nativeBalances) normalizedBalances.set(row.symbol,(normalizedBalances.get(row.symbol)||0n)+decimal(row.reported));
  const allocated = new Map();
  for (const item of payload.allocations.items) {
    const code = assetCode(item.native_asset), amount = decimal(item.amount_allocated?.total?.native);
    allocated.set(code,(allocated.get(code)||0n)+amount);
  }
  // Allocations are a subset of balances, never additive portfolio holdings.
  for (const [code,amount] of allocated) if (amount > (normalizedBalances.get(code)||0n)) blockers.push(`Staking allocation exceeds balance: ${code}`);
  if (payload.allocationMayBeTruncated) blockers.push('Staking allocation coverage incomplete');
  if (Object.keys(payload.positions || {}).length) blockers.push('Open margin positions require review');
  const externalTransfers = Object.entries(payload.ledger).filter(([,l])=>category(l)==='external_crypto_transfer')
    .map(([id,l])=>({id,symbol:assetCode(l.asset),amount:l.amount,fee:l.fee,time:l.time,direction:decimal(l.amount)>=0n?'in':'out'}));
  return {version:1,asOf:payload.asOf,nativeBalancesMatched:blockers.every(x=>!x.startsWith('Native balance mismatch')&&!x.startsWith('Duplicate native balance aliases')),
    nativeBalances,counts,stakingRewards:[...rewards].map(([symbol,r])=>({symbol,count:r.count,gross:format(r.gross),fees:format(r.fees),net:format(r.net)})),
    externalTransfers,settlementGroups:settlements.size,singleAssetSettlementGroups:[...settlements.values()].filter(g=>g.length===1).length,
    tradeFills:Object.keys(payload.trades).length,ledgerRows:Object.keys(payload.ledger).length,
    historicalMarginFills:Object.values(payload.trades).filter(t=>Number(t.margin)>0 || Number(t.leverage)>0).length,
    blockers:[...new Set(blockers)],reportingReady:false,
    pending:['Historical valuation and acquisition basis','Consolidated settlement mapping and rounding adjustments','Reporting importer']};
}
async function saveAudit(connection) {
  const db = require('../../config/database');
  return db.withTransaction(async client => {
    const result = await client.query(`SELECT account_identifier,payload FROM broker_import_snapshots
      WHERE user_id=$1 AND broker_type='kraken' AND connection_id=$2 FOR UPDATE`,[connection.userId,connection.id]);
    if (result.rows.length !== 1) throw new Error('A single owner-scoped Kraken snapshot is required');
    const snapshot = result.rows[0], reconciliation = audit(snapshot.payload);
    // A successful native balance audit is not approval to publish profit.
    // Keep the reporting gate closed until valuation and lot mapping pass.
    await client.query(`UPDATE broker_import_snapshots SET payload=jsonb_set(payload,'{nativeReconciliation}',$1::jsonb)
      WHERE account_identifier=$2 AND user_id=$3 AND connection_id=$4 AND broker_type='kraken'`,
    [JSON.stringify(reconciliation),snapshot.account_identifier,connection.userId,connection.id]);
    return reconciliation;
  });
}
module.exports = {decimal,format,assetCode,nativeWalletCode,category,audit,saveAudit};
