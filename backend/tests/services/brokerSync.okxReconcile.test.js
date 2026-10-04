jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../src/services/analyticsCache',()=>({invalidate:jest.fn()}));
const {prepare,mergeRows}=require('../../src/services/brokerSync/okxReconcile');
const {rowsFor}=require('../../src/services/brokerSync/okxAssetLedger');
const ts=Date.parse('2026-01-01T12:00:00Z');
const buy={billId:'buy',tradeId:'1',instId:'TEST-USDT',instType:'SPOT',side:'buy',fillSz:'10',fillPx:'2',fee:'-1',feeCcy:'TEST',fillTime:String(ts)};
const sell={...buy,billId:'sell',tradeId:'2',side:'sell',fillSz:'4',fillPx:'3',fee:'-0.5',feeCcy:'USDT',fillTime:String(ts+86400000)};
function fixture(){return {asOf:'2026-01-02T12:00:00Z',positions:[],funding:[],fills:[sell,buy],bills:[
  {billId:'fund',type:'1',subType:'11',ccy:'USDT',balChg:'100',ts:String(ts-1)},
  {billId:'buy',type:'2',subType:'1',ccy:'TEST',balChg:'9',fee:'-1',px:'2',ts:String(ts),instId:'TEST-USDT',tradeId:'1'},
  {billId:'buyquote',type:'2',subType:'2',ccy:'USDT',balChg:'-20',fee:'0',ts:String(ts),instId:'TEST-USDT',tradeId:'1'},
  {billId:'sell',type:'2',subType:'2',ccy:'TEST',balChg:'-4',fee:'0',px:'3',ts:String(ts+86400000),instId:'TEST-USDT',tradeId:'2'},
  {billId:'sellquote',type:'2',subType:'1',ccy:'USDT',balChg:'11.5',fee:'-0.5',ts:String(ts+86400000),instId:'TEST-USDT',tradeId:'2'}],
  trading:[{details:[{ccy:'USDT',cashBal:'91.5',eqUsd:'90.585'},{ccy:'TEST',cashBal:'5',eqUsd:'15'}]}]};}
const rates={'2026-01-01':1.01,'2026-01-02':.99};
test('FIFO consumes net acquired units and includes both base-asset and quote-asset fees once',()=>{
  const result=prepare(fixture(),rates);const closed=result.trades.find(t=>t.exitTime),open=result.trades.find(t=>!t.exitTime);
  expect(closed.quantity).toBe(4);expect(closed.nativePnl).toBeCloseTo(11.5-20*4/9,10);
  expect(closed.pnl).toBeCloseTo(11.5*.99-20*4/9*1.01,10);
  expect(open.quantity).toBe(5);
  expect(result.positions).toHaveLength(2);expect(result.positions[0]).toMatchObject({symbol:'USDT',instrumentType:'crypto',quantity:91.5});
});
test('rejects missing settlements, missing FX, missing acquisitions and mismatched balances',()=>{
  const p=fixture();p.bills.pop();expect(()=>prepare(p,rates)).toThrow('balance');
  expect(()=>prepare(fixture(),{})).toThrow('historical');
  const incomplete=fixture();incomplete.fills=[sell];expect(()=>prepare(incomplete,rates)).toThrow('settlement');
  const missing=fixture();missing.trading[0].details[1].cashBal='6';expect(()=>prepare(missing,rates)).toThrow('balance');
});
test('history merge retains records outside the API window and rejects changes to existing identities',()=>{
  expect(mergeRows([buy],[buy,sell])).toEqual([buy,sell]);
  expect(mergeRows([buy],[Object.fromEntries(Object.entries(buy).reverse())])).toHaveLength(1);
  expect(()=>mergeRows([buy],[{...buy,fillPx:'9'}])).toThrow('Conflicting');
});
test('USDT wallet remains an asset valuation and excludes transfers from deposits and income',()=>{
  const p={...fixture(),rates};const rows=rowsFor(p,'2026-01-02');
  expect(rows.at(-1).balance).toBeCloseTo(90.585,10);
  expect(rows.reduce((s,r)=>s+r.net,0)).toBeCloseTo(90.585,10);
  expect(rows.reduce((s,r)=>s+r.deposits+r.income,0)).toBe(0);
  expect(rows[1].fx_adjustments).toBeCloseTo(-1.6,10);
  expect(rows.reduce((s,r)=>s+r.fees,0)).toBeCloseTo(2*1.01+.5*.99,10);
});


test('transfer retention preserves older records and accepts pending-to-completed updates',()=>{
 const {mergeTransfers}=require('../../src/services/brokerSync/okxReconcile');
 const pending={wdId:'one',ccy:'USDT',amt:'10',ts:'1',state:'0'};
 const complete={...pending,state:'2',fee:'1',feeCcy:'USDT',txId:'test-hash'};
 expect(mergeTransfers([pending],[complete],'wdId')).toEqual([complete]);
 expect(mergeTransfers([complete],[],'wdId')).toEqual([complete]);
 expect(()=>mergeTransfers([complete],[{...complete,amt:'11'}],'wdId')).toThrow('Conflicting');
 expect(()=>mergeTransfers([complete],[pending],'wdId')).toThrow('Conflicting');
});

test('outgoing spot coins reduce FIFO holdings without creating a sale or profit',()=>{
 const p=fixture();p.bills.push({billId:'out',type:'1',subType:'12',ccy:'TEST',balChg:'-2',ts:String(ts+2*86400000)});
 p.trading[0].details[1]={ccy:'TEST',cashBal:'3',eqUsd:'9'};
 const result=prepare(p,rates);
 expect(result.trades.filter(t=>t.exitTime)).toHaveLength(1);
 expect(result.trades.find(t=>!t.exitTime).quantity).toBe(3);
 expect(result.positions.find(p=>p.symbol==='TEST').quantity).toBe(3);
});
