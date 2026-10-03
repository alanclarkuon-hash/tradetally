jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const {prepare}=require('../../src/services/brokerSync/krakenLots');
const {rowsFor}=require('../../src/services/brokerSync/krakenCashLedger');
const ts=Date.parse('2026-01-01T12:00:00Z')/1000;
const row=(asset,amount,balance,type,time,extra={})=>({asset,amount,balance,type,time,fee:'0',subtype:'',...extra});
function fixture(){return {historyDownloaded:true,asOf:'2026-01-03T12:00:00Z',positions:{},trades:{},allocations:{items:[]},
  balances:{ZGBP:{balance:'91.7'},TEST:{balance:'5.9'},USDT:{balance:'39.8'}},
  ledger:{fund:row('ZGBP','100','100','deposit',ts),buy:row('TEST','10','9','trade',ts+1,{fee:'1',refid:'buy'}),
    buycash:row('ZGBP','-20','79.8','trade',ts+1,{fee:'0.2',refid:'buy'}),
    incoming:row('USDT','50','50','deposit',ts+2),reward:row('TEST','1','9.9','staking',ts+86400,{fee:'0.1'}),
    withdrawal:row('USDT','-10','39.8','withdrawal',ts+86401,{fee:'0.2'}),
    sell:row('TEST','-4','5.9','trade',ts+172800,{refid:'sell'}),
    sellcash:row('ZGBP','12','91.7','trade',ts+172800,{fee:'0.1',refid:'sell'})},
  valuation:{complete:true,asOf:'2026-01-03T12:00:00Z',estimatedSymbols:[],method:'synthetic daily close',
    rates:{GBP:{'2026-01-01':1.2,'2026-01-02':1.25,'2026-01-03':1.3},TEST:{'2026-01-02':3},USDT:{'2026-01-01':.99,'2026-01-02':1.01}},
    current:{GBP:{price:1.3},TEST:{price:4},USDT:{price:1}}}};}
test('FIFO includes both fee currencies once and treats rewards as valued acquisition lots',()=>{
  const m=prepare(fixture()),closed=m.trades.filter(t=>t.exitTime);
  expect(closed).toHaveLength(1);expect(closed[0].pnl).toBeCloseTo(11.9*1.3-20.2*1.2*4/9,10);
  expect(m.positions.find(p=>p.symbol==='TEST')).toMatchObject({quantity:5.9,currentValue:23.6});
  expect(m.events.find(e=>e.type==='interest').amount).toBeCloseTo(2.7,10);
  expect(m.positions.find(p=>p.symbol==='USDT').quantity).toBe(39.8);
  expect(m.events.filter(e=>e.type==='deposit')).toHaveLength(1); // external USDT is not new funding
});
test('cash uses actual fiat wallets and FX revaluation; coin rewards and transfers do not inflate it',()=>{
  const rows=rowsFor(fixture(),'2026-01-03');
  expect(rows.at(-1).balance).toBeCloseTo(91.7*1.3,10);
  expect(rows.reduce((s,r)=>s+r.net,0)).toBeCloseTo(rows.at(-1).balance,10);
  expect(rows.reduce((s,r)=>s+r.deposits,0)).toBe(120);
  expect(rows.reduce((s,r)=>s+r.income,0)).toBeCloseTo(2.7,10);
  expect(rows.reduce((s,r)=>s+r.withdrawals,0)).toBe(0);
});
test('migrations preserve historical cost and do not create a sale',()=>{
  const p=fixture();p.balances={ZGBP:{balance:'79.8'},POL:{balance:'9'}};p.trades={};
  p.ledger={fund:p.ledger.fund,buy:{...p.ledger.buy,asset:'MATIC'},buycash:p.ledger.buycash,
    outgoing:row('MATIC','-9','0','transfer',ts+86400),incoming:row('POL','9','9','transfer',ts+86401)};
  p.valuation.current.POL={price:3};const m=prepare(p);
  expect(m.trades.filter(t=>t.exitTime)).toHaveLength(0);
  expect(m.positions).toHaveLength(1);expect(m.positions[0].symbol).toBe('POL');
  expect(m.positions[0].totalCost).toBeCloseTo(24.24,10);
});
test('missing balances or valuation cannot enter reports',()=>{
  const p=fixture();p.valuation.complete=false;expect(()=>prepare(p)).toThrow('historical price coverage');
  const q=fixture();q.balances.TEST.balance='100';expect(()=>prepare(q)).toThrow('reconciliation');
});
module.exports={fixture};
