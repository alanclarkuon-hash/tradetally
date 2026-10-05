const {createClient}=require('../src/services/coinGeckoClient');
function fixture(options={}) {
 let clock=100000, disk=null;
 const storage={readFile:jest.fn(async()=>{if(!disk)throw Object.assign(new Error('missing'),{code:'ENOENT'});return disk;}),mkdir:jest.fn(),
  writeFile:jest.fn(async(_file,value)=>{disk=value;}),rename:jest.fn()};
 const transport={get:jest.fn().mockResolvedValue({data:{ok:true}})};
 const sleep=jest.fn(async ms=>{clock+=ms;});
 const make=()=>createClient({storage,transport,sleep,now:()=>clock,...options});
 return {client:make(),make,transport,storage,sleep,advance:ms=>{clock+=ms;}};
}
test('shares one queue across endpoint types, spaces calls and deduplicates concurrent requests',async()=>{
 const f=fixture();
 await Promise.all([f.client.get('/coins/sui'),f.client.get('/coins/sui'),f.client.get('/simple/price')]);
 expect(f.transport.get).toHaveBeenCalledTimes(2);expect(f.sleep).toHaveBeenCalledWith(10000);
 expect(f.transport.get.mock.calls[0][1].timeout).toBe(15000);
});
test('cached requests spend no budget; rolling budget survives restarts',async()=>{
 const f=fixture({allowance:2});
 await f.client.get('/coins/sui',{ttl:86400000});await f.client.get('/coins/sui',{ttl:86400000});
 await f.make().get('/coins/bitcoin');
 await expect(f.make().get('/coins/ethereum')).rejects.toThrow('monthly budget');expect(f.transport.get).toHaveBeenCalledTimes(2);
 f.advance(32*86400000);await f.make().get('/coins/ethereum');expect(f.transport.get).toHaveBeenCalledTimes(3);
});
test('429 respects Retry-After across restarts and failed calls consume budget',async()=>{
 const f=fixture({allowance:2});
 f.transport.get.mockRejectedValueOnce({response:{status:429,headers:{'retry-after':'3600'}}});
 await expect(f.client.get('/coins/sui')).rejects.toThrow('429');
 f.advance(20*60000);await expect(f.make().get('/coins/bitcoin')).rejects.toThrow('cooldown');
 expect(f.transport.get).toHaveBeenCalledTimes(1);
 f.advance(41*60000);await f.make().get('/coins/bitcoin');
 await expect(f.make().get('/coins/ethereum')).rejects.toThrow('monthly budget');
});
test('persistent storage failure prevents any external request',async()=>{
 const f=fixture();f.storage.writeFile.mockRejectedValue(new Error('disk full'));
 await expect(f.client.get('/coins/sui')).rejects.toThrow('disk full');expect(f.transport.get).not.toHaveBeenCalled();
});
test('malformed persisted budget fails closed',async()=>{
 const f=fixture();f.storage.readFile.mockResolvedValue('{}');
 await expect(f.client.get('/coins/sui')).rejects.toThrow('budget unavailable');expect(f.transport.get).not.toHaveBeenCalled();
});
test('accepts real provider underscore IDs while rejecting URL path traversal',async()=>{
 const f=fixture();await f.client.get('/coins/aaai_agent-by-virtuals');
 await expect(f.client.get('/coins/../secret')).rejects.toThrow('Invalid CoinGecko endpoint');
 expect(f.transport.get).toHaveBeenCalledTimes(1);
});
test('HTTP-date Retry-After pauses every endpoint type',async()=>{
 const f=fixture();f.transport.get.mockRejectedValueOnce({response:{status:429,headers:{'retry-after':new Date(7300000).toUTCString()}}});
 await expect(f.client.get('/coins/sui')).rejects.toThrow('429');f.advance(3600000);
 await expect(f.make().get('/simple/price')).rejects.toThrow('cooldown');expect(f.transport.get).toHaveBeenCalledTimes(1);
});
test('coin quote requests share one batch instead of one call per symbol',async()=>{
 jest.resetModules();
 const axios=require('axios');const spy=jest.spyOn(axios,'get').mockResolvedValue({data:{bitcoin:{usd:1},sui:{usd:2}}});
 const fs=require('fs/promises');jest.spyOn(fs,'readFile').mockRejectedValue(Object.assign(new Error('missing'),{code:'ENOENT'}));
 jest.spyOn(fs,'mkdir').mockResolvedValue();jest.spyOn(fs,'writeFile').mockResolvedValue();jest.spyOn(fs,'rename').mockResolvedValue();
 try {
  const client=require('../src/services/coinGeckoClient');
  await Promise.all([client.getPrices('bitcoin'),client.getPrices('sui')]);
  expect(spy).toHaveBeenCalledTimes(1);expect(spy.mock.calls[0][1].params.ids.split(',')).toEqual(expect.arrayContaining(['bitcoin','sui']));
  await client.getPrices('bitcoin');expect(spy).toHaveBeenCalledTimes(1);
 } finally {jest.restoreAllMocks();}
});
