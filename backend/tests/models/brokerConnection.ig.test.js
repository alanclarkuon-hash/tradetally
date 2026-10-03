jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerSync/encryptionService',()=>({encrypt:jest.fn(x=>'encrypted:'+x),decrypt:jest.fn(x=>x.replace('encrypted:',''))}));
const db=require('../../src/config/database'),Connection=require('../../src/models/BrokerConnection');
const row={id:'connection',user_id:'owner',broker_type:'ig',ig_api_key:'encrypted:synthetic-key',ig_username:'encrypted:synthetic-user',
  ig_password:'encrypted:synthetic-password',external_account_id:'synthetic-spread',broker_environment:'live',broker_metadata:{import_pending_review:true}};
test('all IG login credentials are encrypted in storage and omitted from ordinary responses',async()=>{
  db.query.mockResolvedValue({rows:[row]});await Connection.create('owner',{brokerType:'ig',igApiKey:'synthetic-key',igUsername:'synthetic-user',
    igPassword:'synthetic-password',externalAccountId:'synthetic-spread',syncStartDate:'2025-09-01',autoSyncEnabled:true});
  const [sql,args]=db.query.mock.calls[0];expect(sql).toContain("false,'manual'");
  for(const value of ['synthetic-key','synthetic-user','synthetic-password']){expect(args).toContain('encrypted:'+value);expect(args).not.toContain(value);}
  expect(JSON.stringify(Connection.formatConnection(row,false))).not.toMatch(/encrypted|synthetic-key|synthetic-user|synthetic-password/);
  expect(Connection.formatConnection(row,true)).toMatchObject({igApiKey:'synthetic-key',igUsername:'synthetic-user',igPassword:'synthetic-password'});
});
