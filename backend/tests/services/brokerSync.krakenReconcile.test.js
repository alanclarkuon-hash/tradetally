jest.mock('../../src/config/database',()=>({withTransaction:jest.fn()}));
const db=require('../../src/config/database');
const {decimal,format,assetCode,category,audit,saveAudit}=require('../../src/services/brokerSync/krakenReconcile');
const row=(asset,amount,balance,type='deposit',extra={})=>({asset,amount,balance,type,fee:'0',time:1,...extra});
const snapshot=()=>({historyDownloaded:true,asOf:'2026-01-01T00:00:00Z',balances:{ADA:{balance:'1.09',hold_trade:'0.25'}},
  allocations:{items:[{native_asset:'ADA',amount_allocated:{total:{native:'1.09'}}}]},positions:{},trades:{},
  ledger:{deposit:row('ADA','1','1'),reward:row('ADA','0.1','1.09','staking',{fee:'0.01',time:2})}});
test('preserves crypto precision without binary floating point',()=>{
  expect(format(decimal('19873760.13632')+decimal('0.0000000000000001'))).toBe('19873760.1363200000000001');
  expect(format(decimal('-0.01')+decimal('0.009'))).toBe('-0.001');
  for(const value of [null,'NaN','1e-8','1.00000000000000001'])expect(()=>decimal(value)).toThrow();
});
test('staking wallets normalize while coin names remain intact',()=>{
  expect(assetCode('DOT28.S')).toBe('DOT');expect(assetCode('XETH.F')).toBe('ETH');
  expect(assetCode('ETH2.S')).toBe('ETH');expect(assetCode('XXBT')).toBe('BTC');
  expect(assetCode('1INCH')).toBe('1INCH');expect(assetCode('A')).toBe('A');
});
test('rewards are net of native fees; overlapping allocations and reserved cash are not added or removed',()=>{
  const result=audit(snapshot());
  expect(result.blockers).toEqual([]);expect(result.nativeBalancesMatched).toBe(true);
  expect(result.nativeBalances[0]).toMatchObject({reported:'1.09',calculated:'1.09',holdTrade:'0.25'});
  expect(result.stakingRewards).toEqual([{symbol:'ADA',count:1,gross:'0.1',fees:'0.01',net:'0.09'}]);
  expect(result.externalTransfers).toHaveLength(1);expect(result.reportingReady).toBe(false);
});
test('staking transfers and spend/receive conversions are not funding or income',()=>{
  expect(category({type:'transfer',subtype:'autoallocation'})).toBe('staking_transfer');
  expect(category({type:'transfer',subtype:'delistingconversion'})).toBe('asset_conversion');
  expect(category({type:'spend',asset:'ZGBP'})).toBe('conversion');
  expect(category({type:'receive',asset:'USDT'})).toBe('conversion');
  expect(category({type:'deposit',asset:'ZGBP'})).toBe('deposit');
  expect(category({type:'withdrawal',asset:'USDT'})).toBe('external_crypto_transfer');
});
test('mismatched, truncated and margin snapshots stay blocked',()=>{
  const p=snapshot();p.balances.ADA.balance='2';p.allocationMayBeTruncated=true;p.positions.margin={};
  const result=audit(p);expect(result.nativeBalancesMatched).toBe(false);
  expect(result.blockers).toContain('Native balance mismatch: ADA');
  expect(result.blockers).toContain('Staking allocation coverage incomplete');
  expect(result.blockers).toContain('Open margin positions require review');
  const q=snapshot();q.allocations.items[0].amount_allocated.total.native='3';
  expect(audit(q).blockers).toContain('Staking allocation exceeds balance: ADA');
});
test('identifies single-asset settlements without discarding their rounding adjustment',()=>{
  const p=snapshot();p.ledger.dust=row('ADA','0.01','1.10','trade',{time:3,refid:'synthetic-settlement',subtype:'tradespot'});
  p.balances.ADA.balance='1.10';
  expect(audit(p)).toMatchObject({settlementGroups:1,singleAssetSettlementGroups:1,nativeBalancesMatched:true});
});
test('saves only owner-scoped audit metadata while keeping the reporting gate closed',async()=>{
  const client={query:jest.fn().mockResolvedValueOnce({rows:[{account_identifier:'synthetic-account',payload:snapshot()}]})
    .mockResolvedValueOnce({rows:[]})};
  db.withTransaction.mockImplementation(fn=>fn(client));
  expect(await saveAudit({userId:'owner',id:'connection'})).toMatchObject({nativeBalancesMatched:true,reportingReady:false});
  expect(client.query.mock.calls[0][1]).toEqual(['owner','connection']);
  expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
  expect(client.query.mock.calls[1][0]).toContain("'{nativeReconciliation}'");
  expect(client.query.mock.calls[1][1].slice(1)).toEqual(['synthetic-account','owner','connection']);
  expect(client.query.mock.calls.some(([sql])=>/INSERT INTO trades|UPDATE broker_connections/.test(sql))).toBe(false);
});
