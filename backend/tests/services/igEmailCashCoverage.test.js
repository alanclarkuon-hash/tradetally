jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const {analyse,apply}=require('../../src/services/brokerSync/igEmailCashCoverage'),db=require('../../src/config/database');
const header='TextDate,DateUtc,Reference,MarketName,TransactionType,PL Amount,CurrencyIsoCode';
const base={name:'Synthetic',identity:'sample',kind:'share_dealing',transactions:header+'\nx,2026-10-08T12:00:00,base,Cash Interest Paid,DEPO,100,GBP',confirmation:{cash:100,cutoff:'2026-10-08T22:59:59.000Z',holdings:[]}};
const event=(date,ref)=>({reference:'email:'+ref,time:date+'T04:00:00.000Z',date,amount:1,cash:1,type:'interest',description:'Cash interest',source:'ig_email',reportedBalance:date==='2026-10-09'?103:104});
const receipt=(date,ref)=>({id:ref,status:'imported',reason:'activity_pending',evidence:{date,openingCash:date==='2026-10-09'?102:103,cash:date==='2026-10-09'?103:104,positions:[],records:[event(date,ref)],activitySupported:true}});
test('imports only itemised rows while preserving a cumulative cash gap and the verified cutoff',()=>{
 const rows=[receipt('2026-10-09','fri'),receipt('2026-10-12','mon')],before=JSON.stringify([base,rows]);const result=analyse(base,rows);
 expect(result.updated.confirmation).toEqual(base.confirmation);expect(result.prepared.records).toHaveLength(3);
 expect(result.coverage.map(c=>c.difference)).toEqual([2,2]);expect(result.coverage[1].calculated).toBe(102);
 expect(JSON.stringify([base,rows])).toBe(before);
 expect(analyse(result.updated,rows).prepared.records).toHaveLength(3);
});
test('overlapping CSV evidence replaces an email identity rather than duplicating income',()=>{
 const r=receipt('2026-10-09','fri');const b={...base,transactions:base.transactions+'\nx,2026-10-09T04:00:00,export,Cash Interest Paid,DEPO,1,GBP'};
 const p=analyse(b,[r]);expect(p.prepared.records).toHaveLength(2);expect(p.prepared.cashAliases.get('email:fri')).toBe('export');expect(p.coverage[0].difference).toBe(2);
});
test.each(['changed_holdings','unsupported','missing_opening','wrong_balance','cash_mismatch'])('insufficient or inconsistent statement evidence remains for review: %s',reason=>{
 const r=receipt('2026-10-09','fri');if(reason==='changed_holdings')r.evidence.positions=[{isin:'new',quantity:1,cost:1}];if(reason==='unsupported')r.evidence.activitySupported=false;if(reason==='missing_opening')r.evidence.openingCash=null;if(reason==='wrong_balance')r.evidence.records[0].reportedBalance=99;if(reason==='cash_mismatch')r.evidence.records[0].amount=2;
 expect(analyse(base,[r])).toBeNull();
});
test('conflicting original identities cannot be overwritten',()=>{
 const r=receipt('2026-10-09','fri'),b={...base,emailCashRecords:[{...r.evidence.records[0],cash:2,amount:2}]};expect(()=>analyse(b,[r])).toThrow('Conflicting');
});
test('unchanged partial evidence is idempotent without another backup or write',async()=>{
 const r=receipt('2026-10-09','fri');r.reason='unitemised_cash';const p=analyse(base,[r]);db.query.mockResolvedValueOnce({rows:[{payload:{igFileInput:p.updated}}]}).mockResolvedValueOnce({rows:[r]}).mockResolvedValueOnce({rows:[{receipt_id:r.id,reported_cash:103,calculated_cash:101}]});const backup=jest.fn();expect(await apply('owner','account',{backup})).toEqual({changed:false,partial:true});expect(backup).not.toHaveBeenCalled();expect(db.withTransaction).not.toHaveBeenCalled();
});
