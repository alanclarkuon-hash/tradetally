jest.mock('../src/services/coinGeckoClient',()=>({get:jest.fn()}));
jest.mock('fs/promises',()=>({readFile:jest.fn().mockRejectedValue(new Error('missing')),mkdir:jest.fn(),writeFile:jest.fn(),rename:jest.fn()}));
beforeEach(()=>jest.resetModules());
test('known verified IDs require no directory request',async()=>{
 const client=require('../src/services/coinGeckoClient');const service=require('../src/services/coinGeckoIdentityService');
 expect(await service.resolve('SUI')).toEqual({id:'sui'});expect(client.get).not.toHaveBeenCalled();
});
test('discovers new coins, caches directory and refuses ambiguous symbols',async()=>{
 const client=require('../src/services/coinGeckoClient');client.get.mockResolvedValue({data:[{id:'new-coin',symbol:'newc',name:'New Coin'},{id:'dup-one',symbol:'dup',name:'One'},{id:'dup-two',symbol:'dup',name:'Two'}]});
 const service=require('../src/services/coinGeckoIdentityService');
 expect((await service.resolve('NEWC')).id).toBe('new-coin');expect(await service.resolve('DUP')).toBeNull();
 expect(await service.cached('NEWC')).toEqual({id:'new-coin',symbol:'newc',name:'New Coin'});expect(client.get).toHaveBeenCalledTimes(1);
});
test('cached resolution never starts provider calls',async()=>{
 const service=require('../src/services/coinGeckoIdentityService');expect(await service.cached('UNKNOWN')).toBeNull();
 expect(require('../src/services/coinGeckoClient').get).not.toHaveBeenCalled();
});
test('provider underscore IDs do not invalidate the entire directory',async()=>{
 const client=require('../src/services/coinGeckoClient');client.get.mockResolvedValue({data:[
  {id:'aaai_agent-by-virtuals',symbol:'aaai',name:'AAAI_agent by Virtuals'},
  {id:'_',symbol:'gib',name:'Gib'}, {id:'basket-2',symbol:'',name:'Basket'},
  {id:'zetachain',symbol:'zeta',name:'ZetaChain'}]});
 const service=require('../src/services/coinGeckoIdentityService');
 expect((await service.resolve('ZETA')).id).toBe('zetachain');
 expect((await service.resolve('AAAI')).id).toBe('aaai_agent-by-virtuals');
 expect((await service.resolve('GIB')).id).toBe('_');
 expect(client.get).toHaveBeenCalledTimes(1);
 expect(require('fs/promises').writeFile).toHaveBeenCalled();
});
