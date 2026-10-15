jest.mock('axios',()=>({get:jest.fn(),post:jest.fn()}));
jest.mock('../../src/config/database',()=>({query:jest.fn().mockResolvedValue({rows:[]})}));
jest.mock('../../src/models/Trade',()=>({}));
jest.mock('../../src/models/BrokerConnection',()=>({}));
jest.mock('../../src/services/analyticsCache',()=>({}));
const axios=require('axios');
const schwab=require('../../src/services/brokerSync/schwabService');
test('provider failures keep response/account/token details out of console logs',async()=>{
 const spies=['log','warn','error'].map(level=>jest.spyOn(console,level).mockImplementation(()=>{}));
 try {
  const error=new Error('PRIVATE-PROVIDER-DETAIL');
  error.response={status:400,data:{message:'PRIVATE-PROVIDER-DETAIL',balance:123.45}};
  axios.get.mockRejectedValue(error);
  await expect(schwab.getTransactionsForRange('PRIVATE-ACCESS-TOKEN','PRIVATE-ACCOUNT-HASH','2025-01-01','2025-01-02')).rejects.toThrow();
  const logs=spies.flatMap(spy=>spy.mock.calls).flat().map(String).join(' ');
  for(const marker of ['PRIVATE-PROVIDER-DETAIL','PRIVATE-ACCESS-TOKEN','PRIVATE-ACCOUNT-HASH','123.45'])expect(logs).not.toContain(marker);
  expect(logs).toContain('[SCHWAB] Transaction fetch error:');
 }finally{spies.forEach(spy=>spy.mockRestore());}
});
