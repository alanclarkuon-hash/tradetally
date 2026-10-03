jest.mock('axios',()=>({request:jest.fn()}));
jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const axios=require('axios'), db=require('../../src/config/database');
const {IgService,windows,sanitizedError}=require('../../src/services/brokerSync/igService');
const connection={userId:'owner',id:'connection',igApiKey:'synthetic-key',igUsername:'synthetic-user',igPassword:' secret with spaces ',
  externalAccountId:'synthetic-spread',brokerEnvironment:'live',syncStartDate:'2025-09-01'};
const session=()=>({access:'synthetic-access',refresh:'synthetic-refresh',expiresAt:Date.now()+60000,accountId:'synthetic-spread'});
const range={from:'2025-09-01T00:00:00.000',to:'2025-09-30T23:59:59.999'};
beforeEach(()=>jest.clearAllMocks());
test('only allowlisted reads and authentication can reach IG; never dealing, arbitrary hosts or redirects',async()=>{
  const service=new IgService();axios.request.mockResolvedValue({data:{accounts:[]}});
  await service.request(connection,'GET','/accounts','1',{session:session()});
  expect(axios.request.mock.calls[0][0]).toMatchObject({method:'GET',url:'https://api.ig.com/gateway/deal/accounts',
    maxRedirects:0,headers:{'IG-ACCOUNT-ID':'synthetic-spread',Authorization:'Bearer synthetic-access'}});
  for(const [method,path,version] of [['POST','/positions/otc','2'],['PUT','/session','1'],['GET','https://invalid.example','1'],['GET','/accounts','99']]) {
    await expect(service.request(connection,method,path,version)).rejects.toThrow(/Unsupported/);
  }
  expect(axios.request).toHaveBeenCalledTimes(1);
});
test('password is preserved exactly; refresh expiry retains account scope and never stores tokens',async()=>{
  const service=new IgService();service.request=jest.fn().mockResolvedValueOnce({accountId:'synthetic-spread',oauthToken:{
    access_token:'a',refresh_token:'r',expires_in:'60',token_type:'Bearer'}}).mockResolvedValueOnce({access_token:'new-a',refresh_token:'new-r',expires_in:'60'})
    .mockResolvedValueOnce({positions:[]});
  const logged=await service.login(connection);
  expect(service.request.mock.calls[0][4].data.password).toBe(' secret with spaces ');
  logged.expiresAt=Date.now();await service.get(connection,logged,'/positions');
  expect(service.request.mock.calls[1].slice(1,4)).toEqual(['POST','/session/refresh-token','1']);
  expect(logged).toMatchObject({access:'new-a',refresh:'new-r',accountId:'synthetic-spread'});
  expect(db.query).not.toHaveBeenCalled();
});
test('only the selected enabled spread-betting account is accepted; never selects physical or CFD',async()=>{
  const service=new IgService();service.login=jest.fn().mockResolvedValue(session());
  service.get=jest.fn().mockResolvedValue({accounts:[{accountId:'physical',accountType:'PHYSICAL',status:'ENABLED'},
    {accountId:'cfd',accountType:'CFD',status:'ENABLED'},{accountId:'synthetic-spread',accountType:'SPREADBET',status:'ENABLED'}]});
  expect((await service.account(connection)).selected.accountId).toBe('synthetic-spread');
  await expect(service.account(connection,'physical')).rejects.toThrow(/No enabled/);
  service.get.mockResolvedValue({accounts:[{accountId:'a',accountType:'SPREADBET',status:'ENABLED'},{accountId:'b',accountType:'SPREADBET',status:'ENABLED'}]});
  await expect(service.account(connection)).rejects.toThrow(/choose/);
  expect((await service.account(connection,'b')).session.accountId).toBe('b');
});
test('transactions read every page and block missing or changed pagination',async()=>{
  const service=new IgService();service.get=jest.fn().mockResolvedValueOnce({transactions:[{reference:'a'}],metadata:{pageData:{pageNumber:1,totalPages:2}}})
    .mockResolvedValueOnce({transactions:[{reference:'b'}],metadata:{pageData:{pageNumber:2,totalPages:2}}});
  expect(await service.transactions(connection,session(),range)).toHaveLength(2);
  expect(service.get.mock.calls[1][3]).toMatchObject({pageNumber:2,type:'ALL',pageSize:500,...range});
  service.get.mockResolvedValueOnce({transactions:[]});
  await expect(service.transactions(connection,session(),range)).rejects.toThrow(/pagination/);
});
test('activity cursors preserve bounded end time, support omitted to, and reject unsafe or looping URLs',async()=>{
  const service=new IgService();const next='/history/activity?version=3&from=2025-09-15T00:00:00Z&pageSize=500';
  service.get=jest.fn().mockResolvedValueOnce({activities:[{dealId:'a'}],metadata:{paging:{next}}})
    .mockResolvedValueOnce({activities:[{dealId:'b'}],metadata:{paging:{}}});
  expect(await service.activities(connection,session(),range)).toHaveLength(2);
  expect(service.get.mock.calls[1][3]).toMatchObject({to:range.to,from:'2025-09-15T00:00:00Z',detailed:true});
  for(const unsafe of ['https://invalid.example/history/activity?from=2025-09-15','/positions/otc',
    '/history/activity?from=bad','/history/activity?from=2025-08-01','/history/activity?from=2025-09-15&filter=status==REJECTED']) {
    service.get.mockResolvedValueOnce({activities:[],metadata:{paging:{next:unsafe}}});
    await expect(service.activities(connection,session(),range)).rejects.toThrow();
  }
  service.get.mockResolvedValue({activities:[],metadata:{paging:{next}}});
  await expect(service.activities(connection,session(),range)).rejects.toThrow(/advance/);
});
test('monthly windows are disjoint and fixed; invalid or excessive ranges are blocked',()=>{
  const ranges=windows('2025-09-01','2025-11-01');expect(ranges).toHaveLength(2);
  expect(Date.parse(ranges[1].from+'Z')-Date.parse(ranges[0].to+'Z')).toBe(1);
  for(const [from,to] of [['bad','2026-01-01'],['2026-01-01','2025-01-01'],['2000-01-01','2026-01-01']])expect(()=>windows(from,to)).toThrow();
});
test('downloads stage raw records for the owner only, with zero financial postings and no secrets in snapshot',async()=>{
  const service=new IgService();service.account=jest.fn().mockResolvedValue({session:session(),selected:{accountId:'synthetic-spread',accountType:'SPREADBET',currency:'GBP'}});
  service.get=jest.fn().mockResolvedValue({positions:[{position:{dealId:'open'}}]});
  service.transactions=jest.fn().mockResolvedValue([{cashTransaction:false,profitAndLoss:'£10.20',size:'+1',reference:'closed'}]);
  service.activities=jest.fn().mockResolvedValue([{dealId:'closed',details:{currency:'GBP'}}]);db.query.mockResolvedValue({rows:[]});
  const result=await service.syncTrades(connection,{startDate:'2025-09-01',endDate:'2025-09-02'});
  expect(result).toMatchObject({imported:0,tradeRows:1,openPositionRows:1,windowsCompleted:1});
  expect(db.query).toHaveBeenCalledTimes(1);const [sql,args]=db.query.mock.calls[0];
  expect(sql).toContain('INSERT INTO broker_import_snapshots');expect(args.slice(0,3)).toEqual(['owner','IG Spread Betting ****read','connection']);
  const payload=JSON.parse(args[3]);expect(payload.reconciled).toBe(false);
  expect(args[3]).not.toMatch(/synthetic-key|synthetic-user|synthetic-access|secret with spaces/);
});
test('errors never retain credentials or retry information from raw Axios responses',async()=>{
  const error={response:{status:401,data:{errorCode:'error.security.invalid-details',password:'synthetic-private'}},config:{headers:{Authorization:'secret'}}};
  const safe=sanitizedError(error);expect(safe.message).toContain('rejected the login');expect(JSON.stringify(safe)).not.toContain('synthetic-private');
  const service=new IgService();axios.request.mockRejectedValue(error);
  const validation=await service.validateCredentials('synthetic-key','synthetic-user','synthetic-password');
  expect(validation.valid).toBe(false);expect(axios.request).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(validation)).not.toContain('synthetic-password');
});
