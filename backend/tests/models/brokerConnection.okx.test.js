jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerSync/encryptionService',()=>({encrypt:jest.fn(v=>`encrypted:${v}`),decrypt:jest.fn(v=>v.replace('encrypted:',''))}));
const db=require('../../src/config/database');
const BrokerConnection=require('../../src/models/BrokerConnection');
const row={id:'connection',user_id:'owner',broker_type:'okx',okx_api_key:'encrypted:key',okx_api_secret:'encrypted:secret',
  okx_passphrase:'encrypted:passphrase',external_account_id:'1234',broker_environment:'global',broker_metadata:{import_pending_review:true}};
test('encrypts all three credentials and keeps initial imports manual',async()=>{
  db.query.mockResolvedValue({rows:[row]});
  await BrokerConnection.create('owner',{brokerType:'okx',okxApiKey:'key',okxApiSecret:'secret',okxPassphrase:'passphrase',externalAccountId:'1234'});
  const [sql,params]=db.query.mock.calls[0];
  for(const value of ['key','secret','passphrase']) {expect(params).toContain('encrypted:'+value);expect(params).not.toContain(value);}
  expect(sql).toContain("false,'manual'");
  expect(params).toContain('global');
});
test('public connection responses expose no credential values',()=>{
  const result=BrokerConnection.formatConnection(row,false);
  expect(JSON.stringify(result)).not.toContain('encrypted:');
  for(const key of ['okxApiKey','okxApiSecret','okxPassphrase'])expect(result).not.toHaveProperty(key);
  expect(BrokerConnection.formatConnection(row,true)).toMatchObject({okxApiKey:'key',okxApiSecret:'secret',okxPassphrase:'passphrase'});
});
