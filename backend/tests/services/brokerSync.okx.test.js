jest.mock('axios',()=>({get:jest.fn()}));
jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const axios=require('axios');
const db=require('../../src/config/database');
const {createHmac}=require('crypto');
const service=require('../../src/services/brokerSync/okxService');
const connection={id:'connection',userId:'owner',externalAccountId:'1234',okxApiKey:'test-key',okxApiSecret:'test-secret',okxPassphrase:'test-passphrase',brokerEnvironment:'global',brokerMetadata:{import_pending_review:true}};
beforeEach(()=>{jest.clearAllMocks();service.queue=Promise.resolve();service.lastRequestAt=-Infinity;});

test('signs the exact GET path including query parameters and disables redirects',async()=>{
  axios.get.mockResolvedValue({data:{code:'0',data:[]}});
  await service.get(connection,'/api/v5/account/balance',{ccy:'BTC,ETH'});
  const [url,config]=axios.get.mock.calls[0];
  expect(url).toBe('https://www.okx.com/api/v5/account/balance?ccy=BTC%2CETH');
  expect(config.headers['OK-ACCESS-SIGN']).toBe(createHmac('sha256','test-secret').update(config.headers['OK-ACCESS-TIMESTAMP']+'GET'+url.replace('https://www.okx.com','')).digest('base64'));
  expect(config.maxRedirects).toBe(0);
  await expect(service.get(connection,'/api/v5/trade/order')).rejects.toThrow('Unsupported');
  await expect(service.get({...connection,brokerEnvironment:'https://example.com'},'/api/v5/account/balance')).rejects.toThrow('Unsupported');
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test('accepts only read-only keys with an account identity',async()=>{
  const spy=jest.spyOn(service,'get').mockResolvedValue([{uid:'1234',perm:'read_only'}]);
  expect(await service.validateCredentials('key','secret','pass')).toMatchObject({valid:true,accountId:'1234'});
  for(const perm of ['read_only,trade','withdraw','',undefined]) {
    spy.mockResolvedValue([{uid:'1234',perm}]);
    expect(await service.validateCredentials('key','secret','pass')).toMatchObject({valid:false});
  }
  spy.mockRestore();
});

test('sanitizes transport failures without leaking credentials or broker error messages',async()=>{
  axios.get.mockRejectedValue({message:'test-secret',config:{headers:{secret:'test-passphrase'}},response:{status:401}});
  await expect(service.get(connection,'/api/v5/account/config')).rejects.toThrow('HTTP 401');
  service.lastRequestAt=-Infinity;
  axios.get.mockResolvedValue({data:{code:'50102',msg:'test-secret',data:[]}});
  await expect(service.get(connection,'/api/v5/account/config')).rejects.toThrow('clock');
});

test('bounded pagination uses bill IDs and rejects conflicting or repeating pages',async()=>{
  const full=Array.from({length:100},(_,i)=>({billId:String(100-i)}));
  const spy=jest.spyOn(service,'get').mockResolvedValueOnce(full).mockResolvedValueOnce([]);
  expect(await service.pages(connection,'/api/v5/trade/fills-history',{instType:'SPOT'})).toHaveLength(100);
  expect(spy.mock.calls[1][2]).toMatchObject({after:'1'});
  spy.mockResolvedValue(full);
  await expect(service.pages(connection,'/api/v5/trade/fills-history')).rejects.toThrow('did not advance');
  spy.mockRestore();
});

test('stages one complete owner-scoped snapshot only after all reads succeed',async()=>{
  const spy=jest.spyOn(service,'get').mockImplementation(async(c,path)=>{
    if(path.endsWith('/config'))return [{uid:'1234',perm:'read_only'}];
    if(path.endsWith('/balance'))return [{details:[]}];
    return [];
  });
  db.query.mockResolvedValue({rows:[]});
  expect(await service.syncTrades(connection)).toMatchObject({imported:0,outcome:'warning'});
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][1].slice(0,3)).toEqual(['owner','OKX ****1234','connection']);
  db.query.mockClear();
  spy.mockImplementation(async(c,path)=>{if(path.endsWith('/config'))return [{uid:'9999',perm:'read_only'}];return [];});
  await expect(service.syncTrades(connection)).rejects.toThrow('identity');
  expect(db.query).not.toHaveBeenCalled();
  spy.mockRestore();
});
