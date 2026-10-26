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

const {transferBasis}=require('../../src/services/brokerSync/okxTransfers');
function pairedFixture({returned=true,sellInChild=false,stablecoin=false}={}) {
 const main=fixture(),child={positions:[],funding:[],fills:[],bills:[],trading:[{details:[]}]};
 const asset=stablecoin?'USDT':'TEST',amount=2;
 const out={billId:'out-main',type:'1',subType:'12',ccy:asset,balChg:String(-amount),ts:String(ts+1000)};
 const receipt={...out,billId:'in-child',subType:'11',balChg:String(amount),ts:String(ts+1001)};
 main.bills.push(out);child.bills.push(receipt);
 if(returned){child.bills.push({...out,billId:'out-child',ts:String(ts+2000)});main.bills.push({...receipt,billId:'in-main',ts:String(ts+2001)});}
 else if(sellInChild){
   const exit={...sell,billId:'child-sell',tradeId:'3',fillSz:'2',fee:'0',fillTime:String(ts+3000)};
   child.fills.push(exit);child.bills.push({billId:'child-base',type:'2',ccy:'TEST',balChg:'-2',ts:String(ts+3000),instId:exit.instId,tradeId:'3'},
    {billId:'child-quote',type:'2',ccy:'USDT',balChg:'6',ts:String(ts+3000),instId:exit.instId,tradeId:'3'});
   child.trading[0].details=[{ccy:'USDT',cashBal:'6',eqUsd:'6.06'}];
 }else child.trading[0].details=[{ccy:asset,cashBal:'2',eqUsd:'2'}];
 if(!returned){const balance=main.trading[0].details.find(d=>d.ccy===asset);balance.cashBal=String(Number(balance.cashBal)-2);}
 const accounts=[{id:'main',payload:{...main,rates}},{id:'child',payload:{...child,rates}}];
 const receipts=transferBasis(accounts);
 return accounts.map(a=>prepare(a.payload,rates,receipts.get(a.id),a.id));
}
test('verified round-trip preserves original units, acquisition time, cost and FX without a transfer profit',()=>{
 const [main,child]=pairedFixture(),original=prepare(fixture(),rates);
 expect(main.trades.map(t=>({quantity:t.quantity,pnl:t.pnl,entryPrice:t.entryPrice,entryTime:t.entryTime}))).toEqual(original.trades.map(t=>({quantity:t.quantity,pnl:t.pnl,entryPrice:t.entryPrice,entryTime:t.entryTime})));
 expect(main.positions).toEqual(original.positions);expect(child.trades).toEqual([]);expect(child.positions).toEqual([]);
});
test('recipient sale uses the sending acquisition cost and FX rather than transfer-date price',()=>{
 const [main,child]=pairedFixture({returned:false,sellInChild:true});const sale=child.trades[0];
 expect(sale.quantity).toBe(2);expect(sale.entryTime).toBe(new Date(ts).toISOString());expect(sale.entryPrice).toBeCloseTo(20/9*1.01,12);
 expect(sale.pnl).toBeCloseTo(6*1.01-2*20/9*1.01,12);expect(sale.origin).toBe('main');
 expect(main.trades.find(t=>!t.exitTime).quantity).toBe(3);
});
test('USDT internal round-trip retains original dollar basis',()=>{
 const [main,child]=pairedFixture({stablecoin:true});
 expect(main.positions.find(p=>p.symbol==='USDT').totalCost).toBeCloseTo(prepare(fixture(),rates).positions.find(p=>p.symbol==='USDT').totalCost,12);
 expect(child.positions).toEqual([]);
});
test('ambiguous, duplicate or unverified incoming coin transfers fail closed',()=>{
 const p=fixture(),out={billId:'out',type:'1',subType:'12',ccy:'TEST',balChg:'-2',ts:String(ts+1000)};
 p.bills.push(out);
 const receipt={...out,billId:'in',subType:'11',balChg:'2'};
 const child={...fixture(),fills:[],bills:[receipt,{...receipt,billId:'in2'}]};
 expect(()=>transferBasis([{id:'main',payload:{...p,rates}},{id:'child',payload:{...child,rates}}])).toThrow('Ambiguous');
 expect(()=>prepare({...fixture(),bills:[...fixture().bills,receipt]},rates)).toThrow();
});
test('partial transfers retain each acquisition lot and repeated reconstruction is stable',()=>{
 const p=fixture();const extra={...buy,billId:'buy2',tradeId:'4',fee:'0',fillSz:'3',fillPx:'4',fillTime:String(ts+100)};
 p.fills.push(extra);p.bills.push({billId:'base2',type:'2',ccy:'TEST',balChg:'3',ts:String(ts+100),tradeId:'4',instId:extra.instId},
 {billId:'quote2',type:'2',ccy:'USDT',balChg:'-12',ts:String(ts+100),tradeId:'4',instId:extra.instId});
 p.trading[0].details[0].cashBal='79.5';p.trading[0].details[1].cashBal='1';
 const out={billId:'out',type:'1',subType:'12',ccy:'TEST',balChg:'-7',ts:String(ts+2*86400000)};p.bills.push(out);
 const child={positions:[],funding:[],fills:[],bills:[{...out,billId:'in',subType:'11',balChg:'7'}],trading:[{details:[{ccy:'TEST',cashBal:'7',eqUsd:'21'}]}],rates};
 const accounts=[{id:'main',payload:{...p,rates}},{id:'child',payload:child}];
 const first=transferBasis(accounts),second=transferBasis(accounts);
 expect(first).toEqual(second);expect(first.get('child').get('in').lots.map(l=>l.quantity)).toEqual([5,2]);
 const mapped=prepare(child,rates,first.get('child'),'child');
 expect(mapped.trades.map(t=>t.entryPrice)).toEqual([20/9*1.01,4*1.01]);
 expect(mapped.positions[0].totalCost).toBeCloseTo((5*20/9+2*4)*1.01,12);
});

test('stablecoin fragments keep original FIFO FX after returning past a newer funding lot',()=>{
 const main={positions:[],funding:[],fills:[],bills:[
  {billId:'first',type:'1',subType:'11',ccy:'USDT',balChg:'10',ts:String(ts)},
  {billId:'out',type:'1',subType:'12',ccy:'USDT',balChg:'-8',ts:String(ts+1000)},
  {billId:'newer',type:'1',subType:'11',ccy:'USDT',balChg:'10',ts:String(ts+86400000)},
  {billId:'return',type:'1',subType:'11',ccy:'USDT',balChg:'8',ts:String(ts+86400000+2000)},
  {billId:'spend',type:'1',subType:'12',ccy:'USDT',balChg:'-9',ts:String(ts+86400000+3000)}],
  trading:[{details:[{ccy:'USDT',cashBal:'11',eqUsd:'10.89'}]}],rates};
 const child={positions:[],funding:[],fills:[],bills:[
  {...main.bills[1],billId:'receipt',subType:'11',balChg:'8'},
  {...main.bills[3],billId:'return-out',subType:'12',balChg:'-8'}],trading:[{details:[]}],rates};
 const receipt=transferBasis([{id:'main',payload:main},{id:'child',payload:child}]);
 const result=prepare(main,rates,receipt.get('main'),'main');
 expect(result.positions[0].totalCost).toBeCloseTo(1*1.01+10*.99,12);
});
test('joint reconciliation rejects different native parents before loading or changing journals',async()=>{
 const db=require('../../src/config/database'),{reconcile}=require('../../src/services/brokerSync/okxReconcile');
 const client={query:jest.fn().mockResolvedValue({rows:[]})};db.withTransaction.mockImplementation(fn=>fn(client));
 const connection={id:'main',userId:'owner',externalAccountId:'uid-main'};
 await expect(reconcile(connection,{},rates,{accounts:[{connection,payload:{verifiedMainUid:'parent',verifiedUid:'uid-main'}},
 {connection:{id:'child',userId:'owner',externalAccountId:'uid-child'},payload:{verifiedMainUid:'foreign',verifiedUid:'uid-child'}}]})).rejects.toThrow('verified');
 expect(client.query).toHaveBeenCalledTimes(1);
});


test('closing a plan-linked OKX open lot preserves its trade anchor instead of deleting it',async()=>{
 const db=require('../../src/config/database'),{reconcile}=require('../../src/services/brokerSync/okxReconcile');
 const p=fixture();p.fills[0]={...sell,fillSz:'9'};p.bills.find(b=>b.billId==='sell').balChg='-9';p.bills.find(b=>b.billId==='sellquote').balChg='26.5';p.trading[0].details=[{ccy:'USDT',cashBal:'106.5',eqUsd:'105.435'}];
 const open={id:'linked-open',user_id:'owner',broker:'okx',broker_connection_id:'main',account_identifier:'OKX ****main',symbol:'TEST',side:'long',instrument_type:'crypto',original_currency:'USD',quantity:9,entry_price:2.244444,entry_time:new Date(ts).toISOString(),commission:0,fees:0,executions:[{okx_record_key:'buy:open',okx_origin_connection_id:'main',okx_entry:buy,feesIncluded:true}]};
 const client={query:jest.fn(async(sql)=>{if(sql.startsWith('SELECT * FROM trades'))return {rows:[open]};if(sql.startsWith('SELECT * FROM user_accounts'))return {rows:[{currency:'USD'}]};if(sql.startsWith('DELETE FROM trades'))throw Error('trade_plan_allocations_trade_id_fkey');return {rows:[]};})};db.withTransaction.mockImplementation(fn=>fn(client));
 await expect(reconcile({id:'main',userId:'owner',externalAccountId:'uid-main'},p,rates)).resolves.toMatchObject({failed:0});
 expect(client.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM trades'))).toBe(false);
 expect(client.query.mock.calls.some(([sql,args])=>sql.startsWith('UPDATE trades')&&args.includes('linked-open'))).toBe(true);
});
