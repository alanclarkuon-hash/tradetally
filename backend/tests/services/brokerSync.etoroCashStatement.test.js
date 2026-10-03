jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const db=require('../../src/config/database');
const {prepare,loadLedger}=require('../../src/services/brokerSync/etoroCashStatement');
const row=(Type,Amount,Balance,id='1')=>({Date:'01/01/2024 12:00:00',Type,Amount,Balance,'Position ID':id,'Realized Equity Change':Amount});
const detail=value=>({'Date of Payment':'01/01/2024','Position ID':'1','Net Dividend Received (USD)':value});

test('retains split allocation metadata without changing cash or existing record identity',()=>{
 const activity=[row('Deposit',100,100),{...row('corp action: Split',0,100),Details:'TEST/USD 10:1'}];
 const saved=prepare({'Account Activity':activity,Dividends:[]});
 const withoutDetails=prepare({'Account Activity':activity.map(({Details,...r})=>r),Dividends:[]});
 expect(saved.records[1]).toMatchObject({details:'TEST/USD 10:1',cash:0,type:null});
 expect(saved.records[1].reference).toBe(withoutDetails.records[1].reference);
 expect(saved.events).toHaveLength(1);
});
test('matches dividend adjustments in overnight rows once, retaining legitimate equal payments',()=>{
  const s={'Account Activity':[row('Deposit',100,100),row('Overnight fee',2,102),row('Overnight fee',2,104),row('Overnight fee',-1,103)],Dividends:[detail(2),detail(2),detail(2)]};
  const p=prepare(s);
  expect(p.events.filter(e=>e.type==='dividend')).toHaveLength(2);
  expect(p.events.filter(e=>e.type==='account_fee')).toHaveLength(1);
  expect(p.unmatchedDividendDetails).toBe(1);
  expect(new Set(p.records.map(r=>r.reference)).size).toBe(4);
  expect(p.records.reduce((n,r)=>n+r.cash,0)).toBe(103);
});
test('counts funding leaving the USD account, while conversion fees do not create extra cash charges',()=>{
  const p=prepare({'Account Activity':[row('Deposit',100,100),row('Withdraw Request',-20,100),row('Withdrawal Conversion Fee',-.5,80),row('Transfer: USD > GBP',-20,80),row('Staking',3,80)],Dividends:[]});
  expect(p.events.map(e=>e.type)).toEqual(['deposit','withdrawal','withdrawal','interest']);
  expect(p.events[2].description).toBe('Transfer out: USD > GBP');
  expect(p.records[2].cash).toBe(-20);
  expect(p.endingCash).toBe(80);
});
test('references survive longer statements and negative dividend adjustments stay income',()=>{
  const s={'Account Activity':[row('Deposit',100,100),row('Dividend',-2,98)],Dividends:[]};
  const p=prepare(s),longer=prepare({...s,'Account Activity':[...s['Account Activity'],row('Interest Payment',1,99)]});
  expect(longer.records[1].reference).toBe(p.records[1].reference);
  expect(p.events[1]).toMatchObject({type:'dividend',amount:-2});
});
test('rejects missing values and reversed chronological activity',()=>{
  expect(()=>prepare({'Account Activity':[row('Deposit',100,null)],Dividends:[]})).toThrow();
  expect(()=>prepare({'Account Activity':[{...row('Deposit',100,100),Date:'02/01/2024 12:00:00'},row('Dividend',1,101)],Dividends:[]})).toThrow();
});
test('ledger uses statement cash deltas, does not add income twice and reconciles at statement cutoff',async()=>{
  const p=prepare({'Account Activity':[row('Deposit',100,100),row('Staking',3,100),row('Dividend',2,102)],Dividends:[]});
  db.query.mockResolvedValue({rows:[{records:p.records,starting_cash:0,ending_cash:102,currency:'USD',to_date:'2024-01-01'}]});
  const ledger=await loadLedger('user',{id:'account',broker:'etoro',currency:'USD'},'2024-01-01','2024-01-02');
  expect(ledger.balance).toBe(102);
  expect(ledger.rows[0].income).toBe(5);
  expect(ledger.reconciliation.matched).toBe(true);
  expect(ledger.fundingPending).toBe(false);
});
test('withdrawal totals follow reported USD funding amounts while cash follows settlement timing',async()=>{
  const p=prepare({'Account Activity':[row('Deposit',100,100),row('Withdraw Request',-20,100),row('Withdrawal Conversion Fee',-.5,80),row('Transfer: USD > GBP',-10,70)],Dividends:[]});
  db.query.mockResolvedValue({rows:[{records:p.records,starting_cash:0,ending_cash:70,currency:'USD',to_date:'2024-01-01'}]});
  const ledger=await loadLedger('user',{id:'account',broker:'etoro',currency:'USD'},'2024-01-01','2024-01-01');
  expect(ledger.rows[0].withdrawals).toBe(30);
  expect(ledger.balance).toBe(70);
  expect(ledger.reconciliation.matched).toBe(true);
});
test('live API cash is separate from statement reconciliation and does not create income or cashflow',async()=>{
  const p=prepare({'Account Activity':[row('Deposit',100,100)],Dividends:[]});
  db.query.mockResolvedValueOnce({rows:[{records:p.records,starting_cash:0,ending_cash:100,currency:'USD',to_date:'2024-01-01'}]})
    .mockResolvedValueOnce({rows:[{cash:{amount:120,currency:'USD',asOf:'2024-02-01T06:00:00Z'}}]});
  const ledger=await loadLedger('owner',{id:'account',account_identifier:'masked-account',broker:'etoro',currency:'USD'},'2024-01-01','2024-02-01');
  expect(ledger.liveCash.amount).toBe(120);
  expect(ledger.balance).toBe(100);
  expect(ledger.reconciliation.matched).toBe(true);
  expect(ledger.rows).toHaveLength(1);
  expect(db.query.mock.calls.at(-1)[1]).toEqual(['owner','masked-account']);
});
