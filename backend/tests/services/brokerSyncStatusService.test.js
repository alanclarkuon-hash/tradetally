jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const db=require('../../src/config/database');
const {getStatus,failureSummary}=require('../../src/services/brokerSyncStatusService');
test('keeps successful dates alongside newer failures and includes manual accounts',async()=>{
  db.query.mockResolvedValueOnce({rows:[{id:'test',broker_type:'kraken',last_sync_at:'2026-10-01',last_sync_status:'failed',status:'failed',completed_at:'2026-10-02',failed_at:'2026-10-02',error_message:'401 token=private'}]})
    .mockResolvedValueOnce({rows:[{broker:'kraken'},{broker:'ig'}]});
  const rows=await getStatus('test-user');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({lastSuccessfulSyncAt:'2026-10-01',status:'failed',lastFailureAt:'2026-10-02'});
  expect(rows[0].failure).not.toContain('private');
  expect(rows[1].status).toBe('manual');
  expect(db.query.mock.calls.every(call=>call[1][0]==='test-user')).toBe(true);
});
test('does not return unrecognized broker error payloads',()=>{
  expect(failureSummary('raw private response')).toBe('Sync failed. Review the connection on Broker Sync.');
});



test.each(['started','fetching','parsing','importing','processing','pending'])('shows an active %s run instead of its previous outcome',async status=>{
 db.query.mockResolvedValueOnce({rows:[{id:'one',broker_type:'okx',last_sync_status:'failed',status,started_at:'2026-10-01',completed_at:null}]}).mockResolvedValueOnce({rows:[]});
 expect((await getStatus('owner'))[0].status).toBe('running');
});
test('separates labelled connections and reports completed warning outcomes without leaking details',async()=>{
 db.query.mockResolvedValueOnce({rows:[{id:'main',broker_type:'okx',account_label:'Main',status:'completed',last_sync_status:'success',outcome:'warning',last_sync_message:'secret raw payload'},
 {id:'sub',broker_type:'okx',account_label:'Subaccount',status:'completed',last_sync_status:'success'}]}).mockResolvedValueOnce({rows:[{broker:'okx'}]});
 const rows=await getStatus('owner');expect(rows).toHaveLength(2);expect(rows.map(r=>r.accountLabel)).toEqual(['Main','Subaccount']);
 expect(rows[0]).toMatchObject({status:'warning',warning:'Sync completed with warnings. Review Broker Sync.'});expect(JSON.stringify(rows)).not.toContain('secret');
 expect(rows[1].status).toBe('success');
});
test('surfaces expired authorization and a more recent connection error while preserving last success',async()=>{
 db.query.mockResolvedValueOnce({rows:[{id:'one',broker_type:'ibkr',connection_status:'expired',last_sync_status:'failed',last_sync_at:'2026-10-01',failed_at:'2026-10-02',error_message:'old timeout',last_error_at:'2026-10-03',last_error_message:'401 credential=secret'}]}).mockResolvedValueOnce({rows:[]});
 expect((await getStatus('owner'))[0]).toMatchObject({status:'reconnect',lastSuccessfulSyncAt:'2026-10-01',lastFailureAt:'2026-10-03',failure:'Connection authorization or permissions need review.'});
});
test('never reports success for an unfinished run or a never-synced connection',async()=>{
 db.query.mockResolvedValueOnce({rows:[{id:'new',broker_type:'etoro'},{id:'old',broker_type:'kraken',status:'completed',completed_at:'2026-10-02',last_sync_status:'success',failed_at:'2026-10-01',error_message:'restart interrupted'}]}).mockResolvedValueOnce({rows:[]});
 const rows=await getStatus('owner');expect(rows[0]).toMatchObject({status:'never',lastSuccessfulSyncAt:null});expect(rows[1].failure).toContain('interrupted');
});
