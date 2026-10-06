jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const db=require('../../src/config/database'),{mergeTransactions,reconcile}=require('../../src/services/brokerSync/igCsvReconciliation'),{csv}=require('../../src/services/brokerSync/igStatement');
const header='TextDate,DateUtc,Reference,MarketName,TransactionType,PL Amount,CurrencyIsoCode';
const row=(ref,date,amount)=>`x,${date}T12:00:00,${ref},Cash Interest Paid,DEPO,${amount},GBP`;
const original={name:'Synthetic',kind:'share_dealing',identity:'demo',transactions:header+'\n'+row('old','2026-10-01',10),confirmation:{cash:10,cutoff:'2026-10-01T23:59:59.000Z',holdings:[]}};
beforeEach(()=>db.query.mockResolvedValue({rows:[]}));
test('incremental rows merge in date order and an identical overlapping reference is counted once',()=>{
 const text=mergeTransactions(original.transactions,header+'\n'+row('new','2026-10-02',2)+'\n'+row('old','2026-10-01',10));expect(csv(text,'TextDate').map(r=>r.Reference)).toEqual(['old','new']);
});
test('changed saved references are rejected rather than overwritten',()=>expect(()=>mergeTransactions(original.transactions,header+'\n'+row('old','2026-10-01',11))).toThrow('changed'));
test('duplicate new references and mismatched CSV schemas are rejected',()=>{
 expect(()=>mergeTransactions(original.transactions,header+'\n'+row('new','2026-10-02',2)+'\n'+row('new','2026-10-02',2))).toThrow('duplicate');
 expect(()=>mergeTransactions(original.transactions,'TextDate,Reference\nx,new')).toThrow('columns');
});
test('saved dated statement cash validates an incremental upload without any PDF',async()=>{
 db.query.mockResolvedValue({rows:[{evidence:{date:'2026-10-02',cash:12,positions:[],records:[],activitySupported:true}}]});
 const result=await reconcile('owner',original,header+'\n'+row('new','2026-10-02',2));expect(result.confirmation.cash).toBe(12);expect(csv(result.transactions,'TextDate')).toHaveLength(2);expect(db.query).toHaveBeenCalledWith(expect.stringContaining('user_id=$1'),['owner','IG SD demo']);
});
test('an unreconciled partial history cannot invent a balancing entry',async()=>{
 db.query.mockResolvedValue({rows:[{evidence:{date:'2026-10-02',cash:99,positions:[],records:[],activitySupported:true}}]});
 await expect(reconcile('owner',original,header+'\n'+row('new','2026-10-02',2))).rejects.toThrow('Export full history');
});
test('new holdings require execution evidence and spread accounts retain the full-report route',async()=>{
 db.query.mockResolvedValue({rows:[{evidence:{date:'2026-10-02',cash:12,positions:[{isin:'new',quantity:1,cost:2}],records:[]}}]});
 await expect(reconcile('owner',original,header+'\n'+row('new','2026-10-02',2))).rejects.toThrow('Holdings changed');
 await expect(reconcile('owner',{...original,kind:'spread_bet'},original.transactions)).rejects.toThrow('share-dealing');
});
