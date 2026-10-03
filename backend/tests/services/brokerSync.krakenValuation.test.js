jest.mock('axios',()=>({get:jest.fn()}));
const {selectPairs,requiredDates}=require('../../src/services/brokerSync/krakenValuation');
const {directoryLocation,findEntry}=require('../../src/services/brokerSync/krakenArchivePrices');
test('selects crypto USD markets by metadata and labels MATIC proxy explicitly',()=>{
  const p=selectPairs({stock:{base:'SUI',quote:'ZUSD',aclass_base:'tokenized_asset'},
    crypto:{base:'SUI',quote:'ZUSD',aclass_base:'currency'},btc:{base:'XXBT',quote:'ZUSD'},pol:{base:'POL',quote:'ZUSD'}},['SUI','BTC','MATIC']);
  expect(p.SUI.id).toBe('crypto');expect(p.BTC.id).toBe('btc');expect(p.MATIC).toMatchObject({id:'pol',proxy:true});
});
test('requests historical native reward and margin prices, not just current balances',()=>{
  const p={asOf:'2026-01-03T12:00:00Z',balances:{XXBT:{balance:'1'}},ledger:{
    reward:{type:'staking',asset:'DOT28.S',time:1767268800},margin:{type:'settled',asset:'LINK',time:1767268800},
    transfer:{type:'deposit',asset:'XXBT',time:1767268800}}};
  const r=requiredDates(p);expect(r.has('DOT')).toBe(true);expect(r.has('LINK')).toBe(true);expect(r.get('BTC').size).toBe(2);
});
test('rejects corrupt, encrypted, oversized and absent archive entries',()=>{
  const directory=Buffer.alloc(46+17);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(8,10);
  directory.writeUInt32LE(20,20);directory.writeUInt32LE(100,24);directory.writeUInt16LE(17,28);
  directory.write('MATICUSD_1440.csv',46);
  // Correct filename length is 17; only exact names can be selected.
  expect(findEntry(directory,'MATICUSD_1440.csv')).toMatchObject({compressed:20,size:100,offset:0});
  expect(()=>findEntry(directory,'OTHER_1440.csv')).toThrow('absent');
  directory.writeUInt16LE(1,8);expect(()=>findEntry(directory,'MATICUSD_1440.csv')).toThrow('Unsupported');
  expect(()=>directoryLocation(Buffer.alloc(64))).toThrow();
});
