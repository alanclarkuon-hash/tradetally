jest.mock('axios',()=>({get:jest.fn()}));
const axios=require('axios'),market=require('../../src/services/brokerMarketData');
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();});
afterEach(()=>jest.useRealTimers());
test('quote and history consumers share pacing; background calls do not queue behind history',async()=>{
 axios.get.mockResolvedValue({data:{result:{}}});
 const history=market.read('test-paced','https://example.test/history',{});
 expect(await market.read('test-paced','https://example.test/quote',{}, {background:true})).toBeNull();
 await jest.advanceTimersByTimeAsync(2499);expect(axios.get).not.toHaveBeenCalled();
 await jest.advanceTimersByTimeAsync(1);await history;
 const quote=market.read('test-paced','https://example.test/quote',{});
 await jest.advanceTimersByTimeAsync(2500);await quote;
 expect(axios.get).toHaveBeenCalledTimes(2);
});
test('rate-limit payload imposes a shared cooldown without exposing request data',async()=>{
 axios.get.mockResolvedValue({data:{code:'50011'}});
 const work=market.read('test-cooldown','https://example.test/quote',{});const assertion=expect(work).rejects.toThrow('unavailable');
 await jest.advanceTimersByTimeAsync(2500);await assertion;
 expect(await market.read('test-cooldown','https://example.test/quote',{}, {background:true})).toBeNull();
 expect(axios.get).toHaveBeenCalledTimes(1);
});
