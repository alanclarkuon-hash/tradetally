const {rebase,reuseAnchors}=require('../../src/services/brokerSync/okxPlanAllocations');
const {sourceFills,ledger}=require('../../src/services/planningLedger');
const entry={billId:'acquisition',ordId:'synthetic-buy',instId:'TEST-USDT',side:'buy',fillPx:'2',fillSz:'10',fee:'0',feeCcy:'USDT',fillTime:'1767268800000'};
const row=(id,key,q,exit=false)=>({id,user_id:'owner',broker:'okx',broker_connection_id:'main',account_identifier:'synthetic',symbol:'TEST',side:'long',instrument_type:'crypto',original_currency:'USD',quantity:q,entry_price:2,entry_time:'2026-01-01T12:00:00Z',exit_time:exit?'2026-01-02T12:00:00Z':null,exit_price:exit?3:null,commission:0,fees:0,executions:[{okx_record_key:key,okx_origin_connection_id:'main',okx_entry:entry,okx_exit:exit?{billId:'sale'}:null,feesIncluded:true}]});
const link=(t,q=Number(t.quantity),id='link')=>{const f=sourceFills(t)[0];return {id,user_id:'owner',plan_id:'plan',trade_id:t.id,source_key:f.key,source_snapshot:f,stage_key:'a',action:'entry',quantity:q,journal_evidence:{assessmentId:'retained'}}};
const plan={definition:{instrument:'crypto',symbol:'TEST',direction:'long',currency:'USD',accountId:'account',stopPrice:1,entries:[{key:'a'}],exits:[]}};
test('full close reuses the original navigation anchor and preserves allocation ID and economic evidence',()=>{
 const before=row('same-id','acquisition:open',10),after=row('same-id','acquisition:sale',10,true),a=link(before,10);
 const changes=rebase([before],[after],[a]);expect(changes).toHaveLength(1);expect(changes[0].allocation).toBe(a);expect(changes[0].pieces).toHaveLength(1);expect(changes[0].pieces[0]).toMatchObject({tradeId:'same-id',quantity:10,snapshot:{price:2,time:a.source_snapshot.time,currency:'USD',costs:0}});
 const next=[{...a,trade_id:after.id,source_key:changes[0].pieces[0].sourceKey,source_snapshot:changes[0].pieces[0].snapshot}];const old=ledger(plan,[a],[before]),updated=ledger(plan,next,[after]);for(const key of ['entered','openQuantity','positionValue','realisedProfit','capitalRisk'])expect(updated[key]).toBe(old[key]);expect(updated.unresolved).toBe(0);
});
test('partial closes split across current partitions while keeping total plan quantity and costs',()=>{
 const before=row('open','acquisition:open',10),open=row('open','acquisition:open',6),closed=row('closed','acquisition:sale',4,true),a=link(before,8);
 const changes=rebase([before],[open,closed],[a]);expect(changes[0].pieces.map(p=>p.quantity)).toEqual([6,2]);expect(changes[0].pieces.reduce((q,p)=>q+p.quantity,0)).toBe(8);expect(changes[0].pieces.every(p=>p.snapshot.price===a.source_snapshot.price)).toBe(true);
});
test('multiple plans cannot claim more replacement capacity or move a link to another account',()=>{
 const before=row('open','acquisition:open',10),open=row('open','acquisition:open',6),closed=row('closed','acquisition:sale',4,true);
 const changes=rebase([before],[open,closed],[link(before,6,'one'),{...link(before,4,'two'),plan_id:'other'}]);expect(changes.flatMap(c=>c.pieces).reduce((q,p)=>q+p.quantity,0)).toBe(10);
 expect(()=>rebase([before],[open],[link(before,10)])).toThrow(/exceed/);expect(()=>rebase([before],[{...closed,account_identifier:'foreign'}],[link(before,4)])).toThrow(/outside this account/);
});
test('unchanged links remain untouched; cost, FX and source changes fail safely',()=>{
 const before=row('open','acquisition:open',10),a=link(before);expect(rebase([before],[before],[a])).toEqual([]);
 expect(()=>rebase([before],[{...row('closed','acquisition:sale',10,true),entry_price:2.1}],[a])).toThrow(/cost or FX/);
 expect(()=>rebase([before],[row('closed','acquisition:sale',10,true)],[{...a,source_snapshot:{...a.source_snapshot,fingerprint:'changed'}}])).toThrow(/source evidence/);
});
test('dust rounding within source tolerance is retained rather than silently discarded',()=>{
 const before=row('open','acquisition:open',.0000002554000105),after=row('open','acquisition:sale',.0000002554000105,true),a=link(before,.00000026);expect(rebase([before],[after],[a])[0].pieces[0].quantity).toBe(a.quantity);
});
test('only a verified newly created successor can reuse an obsolete open anchor',()=>{
 const before=row('open','acquisition:open',10),closed=row('previous','acquisition:prior-sale',2,true),mapped=[{key:'acquisition:prior-sale',entry,symbol:'TEST',origin:'main'},{key:'acquisition:new-sale',entry,symbol:'TEST',origin:'main'}];
 const anchors=reuseAnchors([before,closed],mapped,{id:'main'},'synthetic');expect(anchors.get('acquisition:new-sale').id).toBe('open');expect(anchors.get('acquisition:prior-sale').id).toBe('previous');
});
