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
