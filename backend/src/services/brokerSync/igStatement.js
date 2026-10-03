// File-only IG imports. No passwords, broker connections or trading requests.
const { parse } = require('csv-parse/sync');
const crypto = require('crypto');
const { localToUTC } = require('../../utils/timezone');

function fail(message) { throw Error(`IG statement: ${message}. No records imported.`); }
function number(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) fail('invalid numeric field');
  const n = Number(text);
  if (!Number.isFinite(n)) fail('invalid numeric field');
  return n;
}
function cents(value) {
  const n = number(value), result = Math.round(n * 100);
  if (!Number.isSafeInteger(result) || Math.abs(n * 100 - result) > .000001) fail('cash amount is not whole pennies');
  return result;
}
function csv(text, firstColumn) {
  const rows = parse(String(text), { bom: true, skip_empty_lines: true, relax_column_count: true });
  const index = rows.findIndex(r => r[0] === firstColumn);
  if (index < 0) fail('missing CSV header');
  const header = rows[index];
  return rows.slice(index + 1).map(r => {
    if (r.length !== header.length) fail('malformed CSV row');
    return Object.fromEntries(header.map((key, i) => [key, r[i]]));
  });
}
function utc(text) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) fail('invalid UTC timestamp');
  const d = new Date(`${text}Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 19) !== text) fail('invalid UTC timestamp');
  return d.toISOString();
}
function london(text) {
  const m = String(text).match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) fail('invalid breakdown date');
  const naive = `${m[3]}-${m[2]}-${m[1]}T${m[4]}`;
  if (new Date(`${naive}Z`).toISOString().slice(0, 19) !== naive) fail('invalid breakdown date');
  return new Date(localToUTC(naive, 'Europe/London')).toISOString();
}
function classify(row,kind) {
  const text = row.MarketName, code = row['Transaction type'];
  if (code === 'DEAL') return ['trade', 'Closed spread bet'];
  if (/Funds Transfer (?:to|from)/i.test(text)) return [cents(row['PL Amount']) >= 0 ? 'transfer_in' : 'transfer_out', 'Transfer between IG accounts'];
  if (/Cash Interest Paid/i.test(text)) return ['interest', 'Cash interest'];
  if (code === 'DIVIDEND') return ['dividend', 'Dividend'];
  if (/withholding|witholding/i.test(text)) return ['tax', 'Dividend withholding tax'];
  if (/Interest for|Stock Borrowing|CRPREM/i.test(text)) return ['account_fee', 'Position funding or borrowing / stop premium'];
  if (/Reabold.*CONS/i.test(text)) return ['asset_adjustment', 'Share consolidation adjustment'];
  if(kind==='share_dealing'&&require('./igShares').descriptor(row))return ['asset_adjustment','Share settlement'];
  if (/Bank Deposit|Card payment/i.test(text) && code === 'DEPO') return ['deposit', 'Bank or card deposit'];
  if (/Returned to card|Bank Withdrawal|Bank payment/i.test(text) && code === 'WITH') return ['withdrawal', 'Bank or card withdrawal'];
  fail('unrecognised cash transaction type');
}
function prepare(input) {
  if (!input.name || !input.identity || !['spread_bet', 'share_dealing'].includes(input.kind)) fail('missing account identity');
  const rows = csv(input.transactions, 'TextDate');
  if (!rows.length) fail('empty transaction history');
  const seen = new Set();
  const records = rows.map(r => {
    if (r.CurrencyIsoCode !== 'GBP' || !r.Reference || seen.has(r.Reference)) fail('duplicate reference or unsupported currency');
    seen.add(r.Reference);
    const [type, description] = classify(r,input.kind), time = utc(r.DateUtc), amount = cents(r['PL Amount']) / 100;
    if (['deposit','transfer_in'].includes(type) && amount < 0 || ['withdrawal','transfer_out','tax'].includes(type) && amount > 0) fail('cash direction mismatch');
    return { reference: r.Reference, time, date: time.slice(0,10), amount, cash: amount, type, description };
  }).sort((a,b) => a.time.localeCompare(b.time) || a.reference.localeCompare(b.reference));
  const balance = records.reduce((sum,r) => sum + cents(r.cash), 0);
  const confirmation = input.confirmation;
  if (!confirmation || !/^\d{4}-\d{2}-\d{2}T/.test(confirmation.cutoff)) fail('missing statement balance verification');
  const checkpoint = records.filter(r => r.time <= confirmation.cutoff).reduce((sum,r) => sum + cents(r.cash), 0);
  if (checkpoint !== cents(confirmation.cash)) fail('cash history does not reconcile with statement');
  const trades = [],openingSignatures=[];
  if (input.kind === 'spread_bet') {
    if (!input.breakdown || !input.activity || confirmation.holdings?.length) fail('spread-bet imports require closed history and activity');
    const breakdownAccount = String(input.breakdown).match(/Account\s*:\s*([^"\r\n,]+)/)?.[1]?.trim();
    if (breakdownAccount !== input.identity) fail('breakdown belongs to another account');
    const detail = csv(input.breakdown, 'Closing Ref');
    const activity = csv(input.activity, 'TextEpic');
    const deals = rows.filter(r => r['Transaction type'] === 'DEAL');
    const ids = new Set();
    for (const r of detail) {
      const key = r['Closing Ref'];
      if (!key || ids.has(key)) fail('duplicated closing identity');
      ids.add(key);
      const cash = deals.filter(d => d.Reference.endsWith(key));
      const openings = activity.filter(a => /(?:opened|rolled):/.test(a.Result) && (a.DealId.endsWith(r['Opening Ref']) || a.Result.endsWith(r['Opening Ref'])) && a.ActionStatus === 'ACCEPT');
      if (cash.length !== 1 || openings.length !== 1 || cents(cash[0]['PL Amount']) !== cents(r['P/L'])) fail('trade details do not match cash or opening activity');
      const net = cents(r.Total), gross = cents(r['P/L']);
      const components = ['Funding','Borrowing','Dividends','LR Prem.','Others','Comm.'].reduce((sum,k) => sum + cents(r[k]), gross);
      if (components !== net || r['Trade Ccy.'] !== 'GBP' || !['BUY','SELL'].includes(r.Direction)) fail('trade total or currency mismatch');
      const entryTime = london(r.Opened), exitTime = london(r.Closed);
      if (entryTime > exitTime || exitTime !== utc(cash[0].DateUtc)) fail('trade close date mismatch');
      const entryPrice = number(r.Opening), exitPrice = number(r.Closing), quantity = Math.abs(number(r.Size));
      if (quantity <= 0 || entryPrice <= 0 || exitPrice <= 0) fail('invalid stake or level');
      trades.push({ key, symbol: openings[0].TextEpic, market: r.Market, type: 'spread_bet', entryTime, exitTime,
        entryPrice, exitPrice, quantity, side: r.Direction === 'BUY' ? 'long' : 'short',
        // Dividends are separate income records. Journal profit includes actual
        // funding/borrowing/stop costs once, without also counting dividends.
        pnl: (net - cents(r.Dividends)) / 100,
        fees: -(cents(r.Funding) + cents(r.Borrowing) + cents(r['LR Prem.']) + cents(r.Others) + cents(r['Comm.'])) / 100,
        openingKey: r['Opening Ref'], sourceTotal: net / 100 });
    }
    if (trades.length !== deals.length) fail('missing trade breakdown');
    const allocations = new Map();
    for (const t of trades) allocations.set(t.openingKey, (allocations.get(t.openingKey) || 0) + t.quantity);
    const openBets=confirmation.openBets||[],usedBets=new Set();
    for (const [key, qty] of allocations) {
      const a = activity.filter(r => /(?:opened|rolled):/.test(r.Result) && (r.DealId.endsWith(key) || r.Result.endsWith(key)) && r.ActionStatus === 'ACCEPT');
      if (a.length !== 1 || Math.abs(number(a[0].Size)) + .000001 < qty) fail('history has an overclosed or ambiguous spread bet');
    }
    const openings = activity.filter(r => /(?:opened|rolled):/.test(r.Result) && r.ActionStatus === 'ACCEPT');
    const openingIds=new Set();
    for(const a of openings) {
      const key=a.Result.match(/(?:opened|rolled):\s*([A-Z0-9]+)/)?.[1];
      if(!key||openingIds.has(key))fail('duplicated or missing opening identity');openingIds.add(key);
      const closed=[...allocations].filter(([k])=>a.DealId.endsWith(k)||a.Result.endsWith(k)||k===key).reduce((s,[,q])=>s+q,0);
      const remaining=Math.abs(number(a.Size))-closed;
      if(remaining < -.000001)fail('spread bet is overclosed');
      const closedTrade=trades.find(t=>t.openingKey===key||a.DealId.endsWith(t.openingKey));
      if(remaining<=.000001) {
        if(!closedTrade)fail('opening activity is absent from closed history');
        openingSignatures.push({key,signature:{symbol:a.TextEpic,entryTime:closedTrade.entryTime,entryPrice:number(a.Level),
          side:number(a.Size)>0?'long':'short',originalQuantity:Math.abs(number(a.Size))}});
        continue;
      }
      const matches=openBets.filter(p=>p.betId.endsWith(key));
      if(matches.length!==1)fail('history has a missing close or open spread bet statement');
      const p=matches[0];
      if(usedBets.has(p.betId)||Math.abs(p.quantity-remaining)>.000001||number(a.Level)!==p.entryLevel||
        (number(a.Size)>0?'long':'short')!==p.side||!['£','GBP'].includes(a.Currency))fail('open spread bet differs from opening activity');
      const localDate=p.entryTime && new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'2-digit',year:'2-digit'}).format(new Date(p.entryTime));
      if(a.Date!==localDate)fail('open spread-bet date differs from activity');
      usedBets.add(p.betId);
      const signature={symbol:a.TextEpic,entryTime:p.entryTime,entryPrice:p.entryLevel,side:p.side,originalQuantity:Math.abs(number(a.Size))};
      if(closedTrade&&(closedTrade.entryTime!==p.entryTime||closedTrade.entryPrice!==p.entryLevel||closedTrade.side!==p.side))fail('open and closed portions have different acquisition details');
      openingSignatures.push({key,signature});
      trades.push({key:`open:${key}`,symbol:a.TextEpic,market:p.market,type:'spread_bet',entryTime:p.entryTime,exitTime:null,
        entryPrice:p.entryLevel,exitPrice:null,quantity:remaining,side:p.side,pnl:null,fees:0,openingKey:key,
        openingSignature:signature,openBet:p});
    }
    if(usedBets.size!==openBets.length)fail('a statement open bet is absent from activity history');
    for (const category of [['Funding', /Interest for/i], ['Borrowing', /Stock Borrowing/i], ['Dividends', /never/], ['LR Prem.', /CRPREM/i]]) {
      const actual = rows.filter(r => category[0] === 'Dividends' ? r['Transaction type'] === 'DIVIDEND' : category[1].test(r.MarketName)).reduce((sum,r) => sum + cents(r['PL Amount']),0);
      // The closed P&L report does not yet allocate funding on remaining open
      // stakes. Those actual cash entries remain in the reconciled cash ledger.
      if (!openBets.length && actual !== detail.reduce((sum,r) => sum + cents(r[category[0]]),0)) fail('cash charges or dividends do not match trade breakdown');
    }
  } else {
    if (records.some(r => r.type === 'trade')) fail('share trades require a share execution report');
    for(const h of confirmation.holdings||[])if(!h.symbol||!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(h.isin)||number(h.quantity)<=0||number(h.cost)<0||number(h.value)<0||!Number.isFinite(Date.parse(h.asOf)))fail('incomplete share holding');
    const shares=require('./igShares').build(input,rows,records);
    trades.push(...shares.trades);openingSignatures.push(...shares.openingSignatures);
  }
  const identifier = `IG ${input.kind === 'spread_bet' ? 'SB' : 'SD'} ${input.identity}`;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({records,trades})).digest('hex');
  return {name:input.name, identifier, kind:input.kind, records, trades, fingerprint,
    from:records[0].date, to:records.at(-1).date, endingCash:balance / 100, confirmation,openingSignatures};
}

function pairTransfers(accounts) {
  const legs = accounts.flatMap(a => a.records.filter(r => ['transfer_in','transfer_out'].includes(r.type)).map(r => ({...r,account:a.identifier})));
  const outs = legs.filter(r => r.type === 'transfer_out'), ins = legs.filter(r => r.type === 'transfer_in');
  const pairs = [], occupied = new Set();
  // First match simultaneous postings; widening every window immediately
  // would make repeated round-trip amounts compete with already exact pairs.
  for (const window of [120000,24*3600000]) {
    const candidates = outs.filter(out => !occupied.has(out)).map(out => ({out, ins:ins.filter(incoming => !occupied.has(incoming)
      && incoming.account !== out.account && cents(incoming.amount) === -cents(out.amount)
      && Date.parse(incoming.time) - Date.parse(out.time) >= -120000 && Date.parse(incoming.time) - Date.parse(out.time) <= window)}));
    const unique = candidates.filter(c => c.ins.length === 1 && candidates.filter(other => other.ins.includes(c.ins[0])).length === 1);
    for (const c of unique) { pairs.push({out:c.out,incoming:c.ins[0]}); occupied.add(c.out); occupied.add(c.ins[0]); }
  }
  if (pairs.length * 2 !== legs.length) fail('internal transfer counterpart is missing or ambiguous');
  return pairs;
}
module.exports = {prepare, pairTransfers, cents, csv, london};
