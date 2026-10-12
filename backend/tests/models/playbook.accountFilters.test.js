jest.mock('../../src/config/database',()=>({query:jest.fn().mockResolvedValue({rows:[]})}));
const db=require('../../src/config/database');const Playbook=require('../../src/models/Playbook');
beforeEach(()=>jest.clearAllMocks());
test.each([[null,'TRUE',['owner']],[[],'TRUE',['owner']],[['named'],'tt.account_identifier = ANY($2::text[])',['owner',['named']]],[['__unsorted__'],"(tt.account_identifier IS NULL OR tt.account_identifier = '')",['owner']],[['named','__unsorted__'],"(tt.account_identifier = ANY($2::text[]) OR tt.account_identifier IS NULL OR tt.account_identifier = '')",['owner',['named']]],[['__none__'],'FALSE',['owner']]])('playbook analytics apply consistent account scope %j',async(accounts,predicate,params)=>{
 await Playbook.getAnalytics('owner',accounts);expect(db.query).toHaveBeenCalledTimes(4);
 for(const index of [0,3]){const [sql,values]=db.query.mock.calls[index];expect(sql).toContain(predicate);expect(values).toEqual(params);if(predicate!=='TRUE')expect(sql).toContain('tt.user_id=$1');}
 const [recent,values]=db.query.mock.calls[1];expect(recent).toContain(predicate.replaceAll('tt.','t.'));expect(values).toEqual(params);
 expect(db.query.mock.calls[2][1]).toEqual(['owner']);
});
