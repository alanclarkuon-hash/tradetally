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

