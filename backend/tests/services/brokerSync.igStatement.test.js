jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const {prepare,pairTransfers}=require('../../src/services/brokerSync/igStatement');
const {calculate}=require('../../src/services/brokerSync/igCashLedger');
const {sameCash,tradeHash}=require('../../src/services/brokerSync/igImport');
const encode=rows=>rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
const header=['TextDate','MarketName','Transaction type','Reference','PL Amount','DateUtc','CurrencyIsoCode'];
function cash(type,ref,amount,name,time='2026-06-01T12:00:00'){return ['',name,type,ref,amount,time,'GBP'];}
function input(){return {name:'Synthetic spread account',identity:'SYNTH',kind:'spread_bet',
  transactions:encode([header,cash('DEPO','deposit','100','Bank Deposit'),cash('DEAL','prefixCLOSEKEY','10','Synthetic Market','2026-06-02T12:00:00'),
    cash('WITH','fee','-1','Long Interest for synthetic'),cash('DIVIDEND','dividend','2','Synthetic dividend')]),
  breakdown:encode([['Account : SYNTH'],['Closing Ref','Closed','Opening Ref','Opened','Market','Period','Direction','Size','Opening','Closing','Trade Ccy.','P/L','Funding','Borrowing','Dividends','LR Prem.','Others','Comm.','Total'],
    ['CLOSEKEY','02-06-2026 13:00:00','OPENKEY1','01-06-2026 13:00:00','Synthetic Market','DFB','BUY','.5','200','220','GBP','10','-1','0','2','0','0','0','11']]),
  activity:encode([['TextEpic','DealId','Result','ActionStatus','Size','Level'],['SYNTH.EPIC','prefixOPENKEY1','Position opened: OPENKEY1 trailing order text','ACCEPT','+0.5','200']]),
  confirmation:{cash:111,cutoff:'2026-06-03T00:00:00.000Z',holdings:[]}};}
test('reconciles exact cash, UK summer time and original stake; excludes separately reported dividend from journal P&L',()=>{
  const a=prepare(input());expect(a.endingCash).toBe(111);expect(a.trades[0]).toMatchObject({quantity:.5,pnl:9,fees:1,entryTime:'2026-06-01T12:00:00.000Z',symbol:'SYNTH.EPIC'});
});
test.each(['duplicate','missing close','wrong balance','wrong currency','missing fee','wrong account'])('refuses %s before importing',kind=>{
  const x=input();
  if(kind==='duplicate')x.transactions+='\n'+encode([cash('DEPO','deposit','100','Bank Deposit')]);
  if(kind==='missing close')x.activity=x.activity.replace('+0.5','+1');
  if(kind==='wrong balance')x.confirmation.cash=112;
  if(kind==='wrong currency')x.transactions=x.transactions.replace('GBP','USD');
  if(kind==='missing fee')x.breakdown=x.breakdown.replace('"-1"','"-2"');
  if(kind==='wrong account')x.identity='OTHER';
  expect(()=>prepare(x)).toThrow(/No records imported/);
});
function account(id,entries){return {identifier:id,records:entries.map(([type,amount,time,ref])=>({type,amount,time,reference:ref}))};}
test('pairs exact repeated round trips before unique overnight remainder',()=>{
  const a=account('A',[['transfer_out',-50,'2026-06-01T12:00:00Z','1'],['transfer_in',50,'2026-06-02T10:00:00Z','2'],['transfer_out',-3,'2026-06-01T20:00:00Z','3']]);
  const b=account('B',[['transfer_in',50,'2026-06-01T12:00:00Z','4'],['transfer_out',-50,'2026-06-02T10:00:00Z','5'],['transfer_in',3,'2026-06-02T08:00:00Z','6']]);
  expect(pairTransfers([a,b])).toHaveLength(3);
});
test('ambiguous equal-amount transfers are not greedily assigned',()=>{
  const a=account('A',[['transfer_out',-3,'2026-06-01T12:00:00Z','1']]);
  const b=account('B',[['transfer_in',3,'2026-06-01T12:00:00Z','2'],['transfer_in',3,'2026-06-01T12:00:00Z','3']]);
  expect(()=>pairTransfers([a,b])).toThrow(/ambiguous/);
});
test('native cashflow uses settled profit, excludes transfers from external funding and preserves date-range opening cash',()=>{
  const report={starting_cash:0,ending_cash:111,to_date:'2026-06-02',records:[
    {date:'2026-06-01',cash:100,type:'transfer_in'}, {date:'2026-06-02',cash:10,type:'trade'},
    {date:'2026-06-02',cash:2,type:'dividend'},{date:'2026-06-02',cash:-1,type:'account_fee'}]};
  const ledger=calculate(report,'2026-06-02','2026-06-02');
  expect(ledger).toMatchObject({openingBalance:100,balance:111,reconciliation:{matched:true}});
  expect(ledger.rows[0]).toMatchObject({deposits:0,withdrawals:0,trade_inflow:10,income:2,fees:1,net:11});
});
test('repeat validation tolerates PostgreSQL JSONB key ordering but refuses changed cash',()=>{
  const a={reference:'synthetic',time:'2026-06-01T12:00:00.000Z',date:'2026-06-01',amount:7,cash:7,type:'interest',description:'Cash interest'};
  const b=Object.fromEntries(Object.entries(a).reverse());
  expect(sameCash(a,b)).toBe(true);
  expect(sameCash(a,{...b,cash:8})).toBe(false);
  expect(sameCash(undefined,b)).toBe(false);
});
test('monthly holding valuations can change while acquisition cost remains immutable',()=>{
  const t={key:'holding:synthetic',entryPrice:3,quantity:2,holding:{cost:6,quantity:2,value:7,asOf:'2026-06-01T00:00:00Z'}};
  expect(tradeHash(t)).toBe(tradeHash({...t,holding:{...t.holding,value:8,asOf:'2026-07-01T00:00:00Z'}}));
  expect(tradeHash(t)).not.toBe(tradeHash({...t,holding:{...t.holding,cost:8}}));
  expect(tradeHash(t)).toBe(tradeHash({...t,holding:{asOf:t.holding.asOf,value:7,quantity:2,cost:6}}));
});
function partial(){const x=input();x.activity=encode([['TextEpic','DealId','Result','ActionStatus','Size','Level','Currency','Date'],
  ['SYNTH.EPIC','prefixOPENKEY1','Position opened: OPENKEY1','ACCEPT','+0.75','200','GBP','01/06/26']]);
  x.confirmation.openBets=[{betId:'DIAASYNTHOPENKEY1',market:'Synthetic Market',quantity:.25,entryLevel:200,currentLevel:210,
    notional:52.5,margin:5,unrealizedPnL:2.5,side:'long',entryTime:'2026-06-01T12:00:00.000Z',asOf:'2026-06-02T21:00:00.000Z'}];return x;}
test('partial closes retain only the verified remaining stake without making open profit realised',()=>{
  const a=prepare(partial());expect(a.trades).toHaveLength(2);
  expect(a.trades.find(t=>!t.exitTime)).toMatchObject({key:'open:OPENKEY1',quantity:.25,pnl:null,fees:0});
  expect(a.trades.find(t=>t.exitTime)).toMatchObject({quantity:.5,pnl:9});
  expect(a.endingCash).toBe(111);
});
test.each(['stake','price','date','missing activity','missing statement'])('rejects inconsistent %s on remaining stake',kind=>{
  const x=partial();if(kind==='stake')x.confirmation.openBets[0].quantity=.5;
  if(kind==='price')x.confirmation.openBets[0].entryLevel=201;
  if(kind==='date')x.activity=x.activity.replace('01/06/26','02/06/26');
  if(kind==='missing activity')x.confirmation.openBets[0].betId='DIAAOTHERID';
  if(kind==='missing statement')x.confirmation.openBets=[];
  expect(()=>prepare(x)).toThrow(/No records imported/);
});
test('quote updates leave the open fingerprint stable, but stake changes update it',()=>{
  const t=prepare(partial()).trades.find(t=>t.openBet);
  expect(tradeHash(t)).toBe(tradeHash({...t,openBet:{...t.openBet,currentLevel:220,unrealizedPnL:5}}));
  expect(tradeHash(t)).not.toBe(tradeHash({...t,quantity:.1}));
});
