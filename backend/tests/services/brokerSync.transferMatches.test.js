jest.mock('../../src/config/database', () => ({withTransaction: jest.fn(), query: jest.fn()}));
const db = require('../../src/config/database');
const {extract, pair, save, list} = require('../../src/services/brokerSync/transferMatches');
const snapshots = () => [
  {broker_type:'kraken',account_identifier:'synthetic-source',payload:{ledger:{
    sent:{type:'withdrawal',asset:'USDT',amount:'-12.1234567890123456',fee:'0.1',time:1000},
    reward:{type:'staking',asset:'USDT',amount:'1',fee:'0',time:1001},
    fiat:{type:'deposit',asset:'ZGBP',amount:'5',fee:'0',time:1001}}}},
  {broker_type:'okx',account_identifier:'synthetic-destination',payload:{deposits:[
    {depId:'received',ccy:'USDT',amt:'12.1234567890123456',ts:'1010000',state:'2'},
    {depId:'pending',ccy:'USDT',amt:'12.1234567890123456',ts:'1010000',state:'1'}],
    bills:[{ccy:'USDT',sz:'12.1234567890123456',type:'1',subType:'11'}]}},
  {broker_type:'etoro',account_identifier:'synthetic-etoro',payload:{transfers:[{amount:12.1234567890123456}]}}
];
test('matches exact native precision; Kraken fee is separate and internal bills, pending and fiat are ignored', () => {
  const legs = extract(snapshots());
  expect(legs).toHaveLength(2);
  expect(pair(legs)).toHaveLength(1);
  expect(pair(legs)[0].out).toMatchObject({quantity:'12.1234567890123456',fee:'0.1'});
});
test('requires a unique candidate on both sides; rejects fee-subtracted amounts, wrong coin or distant dates', () => {
  const legs = extract(snapshots());
  expect(pair([...legs,{...legs[1],reference:'duplicate-receipt'}])).toEqual([]);
  expect(pair([...legs,{...legs[0],reference:'duplicate-send'}])).toEqual([]);
  for (const change of [{quantity:'12.0234567890123456'},{asset:'BTC'},{time:2000000},{time:900000},{broker:'kraken'}])
    expect(pair([legs[0],{...legs[1],...change}])).toEqual([]);
  expect(() => extract([...snapshots(), snapshots()[0]])).toThrow(/duplicated/);
});
test('saves private audit links only, owner-scoped and without financial postings', async () => {
  const client = {query: jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:snapshots()})
    .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]})};
  db.withTransaction.mockImplementation(fn => fn(client));
  expect(await save('owner')).toEqual({created:1,total:1});
  expect(client.query.mock.calls[1][1]).toEqual(['owner']);
  const [sql, args] = client.query.mock.calls[3];
  expect(sql).toContain('INSERT INTO broker_transfer_matches');
  expect(args.slice(0,1)).toEqual(['owner']);
  expect(args.slice(8,10)).toEqual(['12.1234567890123456','0.1']);
  expect(client.query.mock.calls.some(([q]) => /INSERT INTO trades|INSERT INTO broker_cash_events|UPDATE broker_import_snapshots/.test(q))).toBe(false);
});
const stored = () => ({id:'link',source_broker:'kraken',source_account:'synthetic-source',source_reference:'sent',
  destination_broker:'okx',destination_account:'synthetic-destination',destination_reference:'received',asset:'USDT',
  quantity:'12.1234567890123456',source_fee:'0.1',sent_at:new Date(1000000),received_at:new Date(1010000)});
test('repeating matching does not insert duplicates; changed evidence is blocked', async () => {
  const run = rows => {
    const client={query:jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows})
      .mockResolvedValueOnce({rows:[stored()]})};
    db.withTransaction.mockImplementation(fn=>fn(client)); return client;
  };
  const fractional=snapshots();fractional[0].payload.ledger.sent.time=1000.000557;
  const client=run(fractional);
  expect(await save('owner')).toEqual({created:0,total:1});
  expect(client.query).toHaveBeenCalledTimes(3);
  const changed=snapshots();changed[0].payload.ledger.sent.fee='0.2';run(changed);
  await expect(save('owner')).rejects.toThrow(/changed/);
});
test('read endpoint exposes only owner matches and unlinked movement summaries', async () => {
  db.query.mockResolvedValueOnce({rows:snapshots()}).mockResolvedValueOnce({rows:[stored()]});
  const result=await list('owner');
  expect(result.matches).toHaveLength(1);expect(result.unmatched).toEqual([]);
  expect(result.matches[0].source_reference).toBeUndefined();
  expect(result.matches[0].source_account).toBeUndefined();
  expect(db.query.mock.calls.slice(-2).every(([,args])=>args[0]==='owner')).toBe(true);
});


test('OKX outgoing withdrawals match a unique Kraken receipt with fee conventions kept separate',()=>{
 const raw=[{broker_type:'okx',account_identifier:'source',payload:{withdrawals:[{wdId:'out',state:'2',ccy:'USDT',amt:'10',fee:'1',feeCcy:'USDT',ts:'1000000'}]}},
 {broker_type:'kraken',account_identifier:'destination',payload:{ledger:{received:{type:'deposit',asset:'USDT',amount:'9',fee:'0',time:1010}}}}];
 const legs=extract(raw),matched=pair(legs);
 expect(matched).toHaveLength(1);expect(matched[0].out).toMatchObject({quantity:'9',fee:'1'});
 expect(pair([...legs,{...legs[1],reference:'other',quantity:'10'}])).toEqual([]);
 raw[0].payload.withdrawals[0].state='1';expect(extract(raw)).toHaveLength(1);
 raw[0].payload.withdrawals[0].state='2';raw[0].payload.withdrawals[0].feeCcy='BTC';expect(extract(raw)).toHaveLength(2);expect(pair(extract(raw))).toEqual([]);
});
