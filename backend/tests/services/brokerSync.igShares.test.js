jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const {statementTrades,mergeTrades}=require('../../src/services/brokerSync/igShares');
const {prepare}=require('../../src/services/brokerSync/igStatement');
const {calculate}=require('../../src/services/brokerSync/igCashLedger');
const {tradeHash}=require('../../src/services/brokerSync/igImport');
const encode=rows=>rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
const header=['TextDate','MarketName','Transaction type','Reference','PL Amount','DateUtc','CurrencyIsoCode'];
const security={symbol:'SYN.L',name:'Synthetic PLC',isin:'GB0000000001'};
function statement(side='Bought',quantity=2,price=100,fee=0,cash=-2){return `GBP ACCOUNT ACTIVITY\nDate and Time\n04Jun26\n12:01:02\n111~222 Synthetic PLC\nAt Quote XLON GB0000000001 ${side} GBP ${quantity} ${price} ${fee.toFixed(2)} ${cash.toFixed(2)} 98.00\nBalance 98.00`;}
function input(){const holding={...security,quantity:2,cost:2,value:2.2,asOf:'2026-06-08T21:00:00.000Z'};
  return {name:'Synthetic account',identity:'SYNTH',kind:'share_dealing',shareSecurities:[security],shareLegacyHoldings:[holding],
    shareTrades:statementTrades(statement()),transactions:encode([header,['','Bank Deposit','DEPO','deposit','100','2026-06-01T12:00:00','GBP'],
      ['','Synthetic PLC CONS 2@100 M2M80:999111~222','WITH','buy','-2','2026-06-08T06:00:00','GBP']]),
    confirmation:{cash:98,cutoff:'2026-06-08T22:59:59.999Z',holdings:[holding]}};}
test('reads purchase prices in pence and exact UK execution time independently of cash settlement',()=>{
  const e=statementTrades(statement())[0];expect(e).toMatchObject({dealCode:'111~222',side:'buy',quantity:2,priceGBP:1,priceCurrency:'GBX',time:'2026-06-04T11:01:02.000Z'});
  const a=prepare(input());expect(a.trades[0]).toMatchObject({quantity:2,entryTime:e.time,entryPrice:1,openingKey:'buy'});
  expect(a.records.find(r=>r.reference==='buy')).toMatchObject({type:'share_trade',date:'2026-06-08',cash:-2});
});
test('matches new GBP-priced purchases with fees to the exact debit',()=>{
  expect(statementTrades(statement('Bought',2,5,1,-11))[0]).toMatchObject({priceCurrency:'GBP',priceGBP:5,fees:1,cash:-11});
});
test('company names containing Market remain intact when removing the order type',()=>{
  expect(statementTrades(statement().replace('Synthetic PLC','Synthetic Market PLC'))[0].name).toBe('Synthetic Market PLC');
});
test.each(['cash','price','quantity','date'])('refuses a %s mismatch between contract and settlement',kind=>{
  const x=input();if(kind==='cash')x.shareTrades[0].cash=-3;
  if(kind==='price')x.shareTrades[0].reportedPrice=101;
  if(kind==='quantity')x.shareTrades[0].quantity=1;
  if(kind==='date')x.shareTrades[0].time='2026-06-09T12:00:00Z';
  expect(()=>prepare(x)).toThrow(/differs from its cash settlement/);
});
test('FIFO partial sales create a realised portion and retain the remaining owned shares',()=>{
  const x=input();const sale={...statementTrades(statement('Sold',1,150,0,1.5))[0],dealCode:'333~444',time:'2026-06-09T12:00:00.000Z'};
  x.shareTrades.push(sale);x.transactions+='\n'+encode([['','Synthetic PLC CONS 1@150 M2M80:333~444','DEPO','sell','1.5','2026-06-10T06:00:00','GBP']]);
  x.confirmation={cash:99.5,cutoff:'2026-06-10T22:59:59.999Z',holdings:[{...x.confirmation.holdings[0],quantity:1,cost:1,value:1.5}]};
  const a=prepare(x);expect(a.trades.find(t=>t.exitTime)).toMatchObject({quantity:1,pnl:.5,entryPrice:1,exitPrice:1.5});
  expect(a.trades.find(t=>!t.exitTime)).toMatchObject({quantity:1,pnl:null});
});
test('a full sale clears holdings without forgetting security identity or acquisition cost',()=>{
  const x=input(),sale={...statementTrades(statement('Sold',2,150,0,3))[0],dealCode:'333~444',time:'2026-06-09T12:00:00.000Z'};
  x.shareTrades.push(sale);x.transactions+='\n'+encode([['','Synthetic PLC CONS 2@150 M2M80:333~444','DEPO','sell','3','2026-06-10T06:00:00','GBP']]);
  x.confirmation={cash:101,cutoff:'2026-06-10T22:59:59.999Z',holdings:[]};
  const a=prepare(x);expect(a.trades).toHaveLength(1);expect(a.trades[0]).toMatchObject({quantity:2,pnl:1});
});
test('new trades without contract evidence and sales without acquisitions stop the import',()=>{
  const x=input();x.shareTrades=[];x.shareLegacyHoldings=[];expect(()=>prepare(x)).toThrow(/containing the new share/);
  const y=input();y.shareTrades[0]={...statementTrades(statement('Sold',2,100,0,2))[0]};
  y.transactions=y.transactions.replace('"WITH","buy","-2"','"DEPO","buy","2"');y.confirmation.cash=102;
  expect(()=>prepare(y)).toThrow(/exceeds the verified acquisition/);
});
test('cashflow separates share fees and preserves settled net cash on both sides',()=>{
  const r={starting_cash:100,ending_cash:103,to_date:'2026-06-03',records:[
    {date:'2026-06-02',type:'share_trade',cash:-11,shareFees:1},
    {date:'2026-06-03',type:'share_trade',cash:14,shareFees:1}]};
  const a=calculate(r,'2026-06-01','2026-06-03');
  expect(a.rows[0]).toMatchObject({trade_outflow:10,fees:1,net:-11});
  expect(a.rows[1]).toMatchObject({trade_inflow:15,fees:1,net:14});expect(a.reconciliation.matched).toBe(true);
});
test('retained execution evidence and open fingerprints tolerate JSONB key ordering',()=>{
  const e=statementTrades(statement())[0],reordered=Object.fromEntries(Object.entries(e).reverse());
  expect(mergeTrades([e],[reordered])).toHaveLength(1);
  expect(()=>mergeTrades([e],[{...e,cash:-3}])).toThrow(/execution changed/);
  const t=prepare(input()).trades[0];expect(tradeHash(t)).toBe(tradeHash({...t,holding:{...t.holding,value:3}}));
});
