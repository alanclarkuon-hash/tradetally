jest.mock('../../src/config/database',()=>({connect:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({getRateMap:jest.fn(async()=>({GBP:.8}))}));
jest.mock('../../src/services/brokerSync/igStatement',()=>({prepare:x=>x,pairTransfers:()=>[],cents:x=>Math.round(Number(x)*100)}));
const db=require('../../src/config/database');
const {importAccounts,tradeHash,openingHash}=require('../../src/services/brokerSync/igImport');
const signature={symbol:'SYNTH.EPIC',entryTime:'2026-06-01T12:00:00.000Z',entryPrice:100,side:'long',originalQuantity:2};
const open=()=>({key:'open:SYNTHOPEN',symbol:'SYNTH.EPIC',market:'Synthetic',type:'spread_bet',quantity:1,side:'long',
  entryTime:signature.entryTime,exitTime:null,entryPrice:100,exitPrice:null,pnl:null,fees:0,openingKey:'SYNTHOPEN',openingSignature:signature,
  openBet:{betId:'DIAASYNTHOPEN',entryLevel:100,currentLevel:110,notional:110,unrealizedPnL:10,asOf:'2026-06-03T21:00:00.000Z'}});
const account=trades=>({name:'Synthetic',identifier:'IG SB SYNTH',kind:'spread_bet',from:'2026-06-01',to:'2026-06-03',records:[],endingCash:25,
  confirmation:{cutoff:'2026-06-03T22:59:59.999Z',holdings:[],openBets:trades.filter(t=>t.openBet).map(t=>t.openBet)},trades,
  openingSignatures:[{key:'SYNTHOPEN',signature}]});
function previous(t){return {id:'existing-open',exit_time:null,executions:[{ig_record_key:t.key,ig_source_hash:tradeHash(t),ig_open_bet:true,
  ig_opening_hash:openingHash(signature),type:'entry',quantity:t.quantity}]};}
let client;
function setup(old){client={release:jest.fn(),query:jest.fn(async sql=>{
  if(sql.startsWith('SELECT * FROM user_accounts'))return {rows:[{id:'account',currency:'GBP',initial_balance:0,initial_balance_date:'2026-06-01'}]};
  if(sql.startsWith('SELECT id,executions'))return {rows:old};
  return {rows:[],rowCount:1};
})};db.connect.mockResolvedValue(client);}
beforeEach(()=>jest.clearAllMocks());
test('a later partial close updates the remaining stake in place and rollback previews do not commit',async()=>{
  const t=open();setup([previous({...t,quantity:2})]);const r=await importAccounts('owner',[account([t])]);
  expect(r).toMatchObject({updatedOpenPositions:1,importedTrades:0,matchedTrades:1});
  const update=client.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE trades SET quantity'));
  expect(update[1][0]).toBe(1);expect(update[1].slice(-2)).toEqual(['owner','existing-open']);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');expect(client.query).not.toHaveBeenCalledWith('COMMIT');
});
test('a quote refresh updates only the position snapshot without changing the journal stake',async()=>{
  const t=open();setup([previous({...t,openBet:{...t.openBet,currentLevel:90}})]);
  const r=await importAccounts('owner',[account([t])]);expect(r.updatedOpenPositions).toBe(0);
  expect(client.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE trades SET quantity'))).toBe(false);
  const snapshot=client.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO broker_portfolio_snapshots'));
  expect(JSON.parse(snapshot[1][2])[0]).toMatchObject({instrumentType:'spread_bet',quantity:1,unrealizedPnL:12.5});
});
test('a full close preserves the prior journal ID and records its final realised closed portion',async()=>{
  const t=open();setup([previous(t)]);const {openBet,openingSignature,...closed}=t;
  Object.assign(closed,{key:'SYNTHCLOSE',exitTime:'2026-06-03T12:00:00.000Z',exitPrice:110,pnl:10});
  const r=await importAccounts('owner',[account([closed])]);expect(r).toMatchObject({closedOpenPositions:1,importedTrades:0});
  const update=client.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE trades SET trade_date'));
  expect(update[1].slice(-2)).toEqual(['owner','existing-open']);expect(update[1][6]).toBe(12.5);
  expect(client.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM trades'))).toBe(false);
  const snapshot=client.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO broker_portfolio_snapshots'));expect(JSON.parse(snapshot[1][2])).toEqual([]);
});
test('changed opening cost or missing closed history rolls back before touching the prior open row',async()=>{
  const t=open(),old=previous(t);old.executions[0].ig_opening_hash='changed';setup([old]);
  await expect(importAccounts('owner',[account([])])).rejects.toThrow('Full IG trade history');
  expect(client.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM trades'))).toBe(false);expect(client.query).toHaveBeenCalledWith('ROLLBACK');
});
function stock(){const t=open();delete t.openBet;return {...t,key:'holding:GB0000000001',type:'stock',
  shareLot:{reference:'SYNTHOPEN',executionVerified:true,reportedPriceGBP:100,settlementTime:'2026-06-03T12:00:00.000Z'},
  holding:{symbol:'SYNTH.EPIC',name:'Synthetic',isin:'GB0000000001',quantity:1,cost:100,value:110,asOf:'2026-06-03T21:00:00.000Z'}};}
test('a legacy share seed gains its verified trade date without replacing its journal ID or cash cost',async()=>{
  const t=stock();t.legacyTrade={key:t.key,symbol:t.symbol,type:'stock',market:t.market,quantity:2,entryPrice:100,
    exitPrice:null,pnl:null,fees:0,side:'long',entryTime:t.shareLot.settlementTime,exitTime:null,holding:{...t.holding,quantity:2,cost:200,value:220}};
  const old={id:'existing-share',exit_time:null,executions:[{ig_record_key:t.key,ig_source_hash:tradeHash(t.legacyTrade)}]};
  setup([old]);const a={...account([t]),kind:'share_dealing'};const r=await importAccounts('owner',[a]);
  expect(r).toMatchObject({updatedSharePositions:1,importedTrades:0});
  const update=client.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE trades SET quantity=$1,entry_time'));
  expect(update[1][1]).toBe(signature.entryTime);expect(update[1][5]).toBe(100);expect(update[1].slice(-2)).toEqual(['owner','existing-share']);
});
test('later contract evidence can correct a seed settlement date only when acquisition quantities and cash cost match',async()=>{
  const t=stock(),settledSignature={...signature,entryTime:t.shareLot.settlementTime};
  const old={id:'existing-share',exit_time:null,executions:[{ig_record_key:t.key,ig_source_hash:'previous',ig_open_share:true,
    ig_opening_hash:openingHash(settledSignature),ig_share_execution_time_verified:false,ig_share_settlement_time:t.shareLot.settlementTime}]};
  setup([old]);expect((await importAccounts('owner',[{...account([t]),kind:'share_dealing'}])).updatedSharePositions).toBe(1);
  old.executions[0].ig_opening_hash=openingHash({...settledSignature,entryPrice:101});setup([old]);
  await expect(importAccounts('owner',[{...account([t]),kind:'share_dealing'}])).rejects.toThrow('acquisition changed');
});
test('a stock full close preserves the original journal ID and removes the open stock snapshot',async()=>{
  const t=stock(),old={id:'existing-share',exit_time:null,executions:[{ig_record_key:t.key,ig_source_hash:tradeHash(t),ig_open_share:true,
    ig_opening_hash:openingHash(signature),ig_share_execution_time_verified:true}]};setup([old]);
  const {shareLot,holding,openingSignature,...closed}=t;Object.assign(closed,{key:'share-close:SYNTHOPEN:SELL',exitTime:'2026-06-03T12:00:00.000Z',exitPrice:110,pnl:10,shareSettlement:{buy:'SYNTHOPEN',sell:'SELL'}});
  const a={...account([closed]),kind:'share_dealing',openingSignatures:[{key:'SYNTHOPEN',openKey:t.key,signature,executionVerified:true}]};
  const r=await importAccounts('owner',[a]);expect(r.closedOpenPositions).toBe(1);expect(r.importedTrades).toBe(0);
  expect(client.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE trades SET trade_date'))[1].slice(-2)).toEqual(['owner','existing-share']);
});
