const util = require('util');
jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn(), withTransaction: jest.fn(async fn => fn({query: require('../../src/config/database').query})) }));
jest.mock('../../src/models/User', () => ({getSettings:jest.fn().mockResolvedValue({})}));
jest.mock('../../src/models/Trade', () => ({convertHoldTimeRange:jest.fn()}));
jest.mock('../../src/services/tradeQueries', () => ({cacheKey:jest.fn((id,f)=>id+JSON.stringify(f)),getAnalytics:jest.fn()}));
jest.mock('../../src/services/analyticsCache', () => ({get:jest.fn(),set:jest.fn()}));
jest.mock('../../src/utils/cache', () => ({get:jest.fn(),set:jest.fn(),del:jest.fn(),data:{}}));
jest.mock('../../src/utils/logger', () => Object.fromEntries(['info','warn','error','debug','logDebug','logError','logWarn','logImport'].map(k=>[k,jest.fn()])));
jest.mock('../../src/utils/displayCurrency', () => ({convertForDisplay:jest.fn(async(req,data)=>data)}));
jest.mock('../../src/utils/aiService', () => ({}));
jest.mock('../../src/services/oauth2.service', () => ({getClient:jest.fn(),validateRedirectUri:jest.fn(),validateScopes:jest.fn(),isValidCodeChallenge:jest.fn(),getUserConsent:jest.fn(),createAuthorizationCode:jest.fn()}));
const db=require('../../src/config/database'),logger=require('../../src/utils/logger');
const queries=require('../../src/services/tradeQueries'),cache=require('../../src/utils/cache'),persistent=require('../../src/services/analyticsCache');
const trade=require('../../src/controllers/trade.controller'),health=require('../../src/controllers/health.controller'),settings=require('../../src/controllers/settings.controller');
const oauth=require('../../src/controllers/oauth2.controller'),oauthService=require('../../src/services/oauth2.service');
const marker='SYNTHETIC-PRIVATE-MARKER';
let spies;
const response=()=>({status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis(),redirect:jest.fn(),setHeader:jest.fn()});
const logs=()=>[...spies,...Object.values(logger)].flatMap(x=>x.mock.calls).map(a=>util.format(...a)).join('\n');
beforeEach(()=>{jest.clearAllMocks();cache.get.mockReturnValue(null);persistent.get.mockResolvedValue(null);queries.getAnalytics.mockResolvedValue({netPnl:123.456789});spies=['log','info','debug','warn','error'].map(k=>jest.spyOn(console,k).mockImplementation(()=>{}));});
afterEach(()=>spies.forEach(s=>s.mockRestore()));
test.each(['cold','memory','persistent','failure'])('analytics %s retains filters/results without logging identity, filters or source errors',async mode=>{
 const req={user:{id:marker},query:{symbol:marker,accounts:marker,side:'long',minQuantity:'123.456789',includeArchived:'true'}},res=response(),next=jest.fn(),value={netPnl:123.456789};
 if(mode==='memory')cache.get.mockReturnValue(value);
 if(mode==='persistent')persistent.get.mockResolvedValue(value);
 const error=new Error(marker+' 123.456789');if(mode==='failure')queries.getAnalytics.mockRejectedValue(error);
 await trade.getAnalytics(req,res,next);
 if(mode==='failure'){expect(next).toHaveBeenCalledWith(error);expect(res.json).not.toHaveBeenCalled();}
 else{expect(next).not.toHaveBeenCalled();expect(res.json).toHaveBeenCalledWith(value);}
 expect(queries.cacheKey).toHaveBeenCalledWith(marker,expect.objectContaining({includeArchived:true}));
 if(mode==='cold')expect(queries.getAnalytics).toHaveBeenCalledWith(marker,expect.any(Object));
 expect(logs()).not.toContain(marker);expect(logs()).not.toContain('123.456789');
});
test.each([false,true])('health submission success/error=%s omits identity, device, health metadata and database details',async fail=>{
 const req={user:{id:marker},headers:{'x-device-id':marker,'user-agent':marker},body:{healthData:[{date:'2026-01-02',type:marker,value:123.456789,metadata:{note:marker}}]}},res=response();
 if(fail)db.query.mockRejectedValue(new Error(marker));else db.query.mockResolvedValue({rows:[{inserted:true}]});
 await health.submitHealthData(req,res);
 expect(res.status).toHaveBeenCalledWith(fail?500:200);
 if(!fail)expect(db.query).toHaveBeenCalledWith(expect.any(String),expect.arrayContaining([marker]));
 expect(logs()).not.toContain(marker);expect(logs()).not.toContain('123.456789');
});
test('settings malformed import preserves response without logging filename, user or parse-error data',async()=>{
 const res=response();await settings.importUserData({user:{id:marker},file:{originalname:marker,size:123,mimetype:marker,buffer:Buffer.from('{"'+marker+'":')}},res,jest.fn());
 expect(res.status).toHaveBeenCalledWith(400);expect(res.json).toHaveBeenCalledWith({error:'Invalid JSON file'});expect(logs()).not.toContain(marker);
});
test('OAuth trusted authorization returns its code/state only to the caller, never logs request or callback values',async()=>{
 oauthService.getClient.mockResolvedValue({id:marker,name:marker,is_trusted:true,redirect_uris:['https://example.invalid/'+marker]});
 oauthService.validateRedirectUri.mockReturnValue(true);oauthService.validateScopes.mockReturnValue(true);oauthService.isValidCodeChallenge.mockReturnValue(true);oauthService.getUserConsent.mockResolvedValue(null);oauthService.createAuthorizationCode.mockResolvedValue(marker);
 const req={user:{id:marker,username:marker},query:{response_type:'code',client_id:marker,redirect_uri:'https://example.invalid/'+marker,scope:'openid',state:marker,code_challenge:marker,code_challenge_method:'S256'},headers:{accept:'application/json'},originalUrl:'/oauth/authorize?state='+marker};const res=response();
 await oauth.authorize(req,res);
 expect(oauthService.createAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining({userId:marker,redirectUri:'https://example.invalid/'+marker}));
 expect(JSON.stringify([...res.json.mock.calls,...res.redirect.mock.calls])).toContain(marker);expect(logs()).not.toContain(marker);
});
