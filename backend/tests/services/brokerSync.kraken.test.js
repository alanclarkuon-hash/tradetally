jest.mock('axios',()=>({post:jest.fn()}));
jest.mock('../../src/config/database',()=>({connect:jest.fn(),query:jest.fn()}));
const axios=require('axios');
const db=require('../../src/config/database');
const service=require('../../src/services/brokerSync/krakenService');
const permissions=['query-funds','query-open-trades','query-closed-trades','query-ledger'];
const info={iban:'synthetic-account',permissions,queryFrom:'0',queryTo:'0'};
const connection={id:'connection',userId:'owner',krakenApiKey:'synthetic-key',krakenApiSecret:Buffer.from('synthetic-secret').toString('base64'),
  externalAccountId:service.keyInfo(info).accountId,brokerMetadata:{import_pending_review:true}};
let client;
beforeEach(()=>{
  jest.clearAllMocks();service.queue=Promise.resolve();service.lastRequestAt=-Infinity;
  client={query:jest.fn().mockImplementation(async sql=>({rows:sql.includes('RETURNING last_nonce')?[{last_nonce:'12345'}]:[]})),release:jest.fn()};
  db.connect.mockResolvedValue(client);
});
afterEach(()=>jest.restoreAllMocks());

test('history pacing stays within Kraken’s lowest-tier counter replenishment',()=>{
  for(const path of ['/0/private/TradesHistory','/0/private/Ledgers']) {
    expect(service.requestInterval(path)*0.33/1000).toBeGreaterThanOrEqual(2);
  }
  expect(service.requestInterval('/0/private/BalanceEx')*0.33/1000).toBeGreaterThanOrEqual(1);
});

test('rate-limited reads wait a full minute and retry without restarting downloaded history',async()=>{
  jest.useFakeTimers();
  try {
    const spy=jest.spyOn(service,'privateRead').mockRejectedValueOnce(Object.assign(new Error('Rate limited'),{rateLimited:true}))
      .mockResolvedValueOnce({ledger:{a:{time:1}},count:1});
    const pending=service.read(connection,'/0/private/Ledgers',{ofs:'50'});
    await jest.advanceTimersByTimeAsync(59999);
    expect(spy).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({count:1});
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][2]).toEqual({ofs:'50'});
  } finally {jest.useRealTimers();}
});

test('signature matches Kraken’s published authentication example',()=>{
  // Public example from Kraken docs; never a user API credential.
  const secret='kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==';
  const body='nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25';
  expect(service.signature('/0/private/AddOrder','1616492376594',body,secret))
    .toBe('4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==');
});

test('signs read POSTs, persists nonces under a lock, and forbids mutation endpoints',async()=>{
  axios.post.mockResolvedValue({data:{error:[],result:{}}});
  await service.read(connection,'/0/private/BalanceEx');
  const [url,body,config]=axios.post.mock.calls[0];
  expect(url).toBe('https://api.kraken.com/0/private/BalanceEx');
  expect(body).toBe('nonce=12345');
  expect(config.headers['API-Sign']).toBe(service.signature('/0/private/BalanceEx','12345',body,connection.krakenApiSecret));
  expect(config.maxRedirects).toBe(0);
  expect(client.query.mock.calls[0][0]).toContain('pg_advisory_lock');
  expect(client.query.mock.calls[1][0]).toContain('GREATEST(kraken_api_nonces.last_nonce+1');
  expect(client.query.mock.calls[2][0]).toContain('pg_advisory_unlock');
  expect(client.release).toHaveBeenCalled();
  for(const path of ['/0/private/AddOrder','/0/private/Withdraw','/0/private/Earn/Allocate','https://example.com']) {
    await expect(service.read(connection,path)).rejects.toThrow('Unsupported');
  }
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('API permissions exclude all mutation capabilities and restricted history',()=>{
  expect(service.keyInfo(info).accountId).toHaveLength(64);
  for(const extra of ['withdraw-funds','modify-trades','earn-funds','add-funds','close-trades','create-ws-token','unknown']) {
    expect(()=>service.keyInfo({...info,permissions:[...permissions,extra]})).toThrow('Use only');
  }
  expect(()=>service.keyInfo({...info,permissions:permissions.slice(1)})).toThrow('Use only');
  expect(()=>service.keyInfo({...info,queryFrom:'100'})).toThrow('restrictions');
  expect(()=>service.keyInfo({...info,iban:null})).toThrow('identity');
});

test('transport and Kraken failures never expose secrets and always release the lock',async()=>{
  axios.post.mockRejectedValue({message:connection.krakenApiSecret,config:{headers:{'API-Key':connection.krakenApiKey}},response:{status:401}});
  await expect(service.read(connection,'/0/private/BalanceEx')).rejects.toThrow('HTTP 401');
  expect(client.release).toHaveBeenCalled();
  service.lastRequestAt=-Infinity;
  axios.post.mockResolvedValue({data:{error:['EAPI:Invalid nonce:'+connection.krakenApiSecret]}});
  await expect(service.read(connection,'/0/private/BalanceEx')).rejects.toThrow('nonce');
});

test('history fixes the end date and includes every page, fees and ledger identities',async()=>{
  const spy=jest.spyOn(service,'read').mockResolvedValueOnce({count:3,ledger:{a:{time:1,fee:'0.01'},b:{time:2}}})
    .mockResolvedValueOnce({count:3,ledger:{c:{time:3,type:'staking'}}});
  expect(await service.history(connection,'/0/private/Ledgers','ledger',100)).toEqual({a:{time:1,fee:'0.01'},b:{time:2},c:{time:3,type:'staking'}});
  expect(spy.mock.calls[1][2]).toMatchObject({start:'0',end:'100',ofs:'2',type:'all'});
});

test('repeating, changing or truncated pages fail rather than silently omitting history',async()=>{
  const spy=jest.spyOn(service,'read');
  spy.mockResolvedValue({count:2,ledger:{a:{time:1}}});
  await expect(service.history(connection,'/0/private/Ledgers','ledger',100)).rejects.toThrow('repeated');
  spy.mockResolvedValueOnce({count:2,ledger:{a:{time:1}}}).mockResolvedValueOnce({count:3,ledger:{b:{time:2}}});
  await expect(service.history(connection,'/0/private/Ledgers','ledger',100)).rejects.toThrow('changed');
  spy.mockResolvedValueOnce({count:2,ledger:{a:{time:1}}}).mockResolvedValueOnce({count:2,ledger:{}});
  await expect(service.history(connection,'/0/private/Ledgers','ledger',100)).rejects.toThrow('ended');
});

function stagedReads(c,path) {
  if(path.endsWith('GetApiKeyInfo'))return info;
  if(path.endsWith('BalanceEx'))return {'ETH.S':{balance:'1.1'},ZGBP:{balance:'50'}};
  if(path.endsWith('Allocations'))return {items:[{native_asset:'ETH',amount_allocated:{total:{native:'1.1'}}}]};
  if(path.endsWith('TradesHistory'))return {count:0,trades:{}};
  if(path.endsWith('Ledgers'))return {count:1,ledger:{reward:{time:1,type:'staking',asset:'ETH.S',amount:'0.1',fee:'0.01'}}};
  return {};
}
test('stages native staking, fiat and rewards once; never double-adds allocations to balances',async()=>{
  jest.spyOn(service,'read').mockImplementation(stagedReads);
  const output=await service.syncTrades(connection);
  expect(output).toMatchObject({imported:0,outcome:'warning'});
  expect(db.query).toHaveBeenCalledTimes(1);
  const [,params]=db.query.mock.calls[0];
  expect(params.slice(0,3)).toEqual(['owner',`Kraken ****${connection.externalAccountId.slice(-4)}`,'connection']);
  const payload=JSON.parse(params[3]);
  expect(payload.balances['ETH.S'].balance).toBe('1.1');
  expect(payload.ledger.reward.fee).toBe('0.01');
  expect(payload.reconciled).toBe(false);
  expect(params[3]).not.toContain(info.iban);
  expect(params[3]).not.toContain(connection.krakenApiKey);
});

test('changed account or a failed staking read preserves the previous snapshot',async()=>{
  const spy=jest.spyOn(service,'read').mockImplementation(stagedReads);
  await expect(service.syncTrades({...connection,externalAccountId:'wrong'})).rejects.toThrow('identity');
  spy.mockImplementation((c,path)=>{if(path.endsWith('Allocations'))throw Error('staking read failed');return stagedReads(c,path);});
  await expect(service.syncTrades(connection)).rejects.toThrow('staking read failed');
  expect(db.query).not.toHaveBeenCalled();
});
