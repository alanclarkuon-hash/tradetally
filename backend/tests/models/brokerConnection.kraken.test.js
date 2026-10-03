jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerSync/encryptionService',()=>({encrypt:jest.fn(v=>`encrypted:${v}`),decrypt:jest.fn(v=>v.replace('encrypted:',''))}));
const db=require('../../src/config/database');
const BrokerConnection=require('../../src/models/BrokerConnection');
const row={id:'connection',user_id:'owner',broker_type:'kraken',kraken_api_key:'encrypted:key',
  kraken_api_secret:'encrypted:secret',external_account_id:'account-hash',broker_metadata:{import_pending_review:true}};

test('encrypts both credentials and resets replacement keys to manual sync',async()=>{
  db.query.mockResolvedValue({rows:[row]});
  await BrokerConnection.create('owner',{brokerType:'kraken',krakenApiKey:'key',krakenApiSecret:'secret',externalAccountId:'account-hash'});
  const [sql,params]=db.query.mock.calls[0];
  for(const value of ['key','secret']) {expect(params).toContain('encrypted:'+value);expect(params).not.toContain(value);}
  expect(sql).toContain("false,'manual'");
  expect(sql).toContain('next_scheduled_sync=NULL');
});

test('only explicit credential reads decrypt private Kraken keys',()=>{
  const result=BrokerConnection.formatConnection(row,false);
  expect(JSON.stringify(result)).not.toContain('encrypted:');
  expect(result).not.toHaveProperty('krakenApiKey');
  expect(result).not.toHaveProperty('krakenApiSecret');
  expect(BrokerConnection.formatConnection(row,true)).toMatchObject({krakenApiKey:'key',krakenApiSecret:'secret'});
});
