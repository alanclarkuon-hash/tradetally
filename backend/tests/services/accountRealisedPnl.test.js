const {calculateAccountResult}=require('../../src/services/accountRealisedPnl');
const {ledger,sourceFills}=require('../../src/services/planningLedger');
const fill=(action,quantity,price,rate,date,commission=0,fees=0)=>({action,quantity,price,datetime:date,account_currency:'GBP',broker_fx_rate:rate,commission,fees});
const example=()=>({id:'synthetic',side:'long',instrument_type:'stock',original_currency:'USD',quantity:10,entry_price:100,commission:3,fees:1,
 executions:[fill('buy',10,100,1.25,'2026-01-01T10:00:00Z',2),fill('sell',4,120,1.2,'2026-01-02T10:00:00Z',.5,.5),fill('sell',6,130,1.3,'2026-01-03T10:00:00Z',.5,.5)]});
test('partial exits retain entry and exit transaction rates, costs and source data',()=>{
 const trade=example(),before=structuredClone(trade),r=calculateAccountResult(trade,'GBP');
 expect(r.status).toBe('complete');expect(r.entryCost).toBe(800);expect(r.pnl).toBeCloseTo(800-800/10*10+200-2/1.25-1/1.2-1/1.3);
 expect(r.events).toHaveLength(2);expect(r.events.reduce((s,e)=>s+e.pnl,0)).toBeCloseTo(r.pnl);expect(trade).toEqual(before);
});
test('account results reconcile exactly with Planning allocation ledger',()=>{
 const trade=example(),fills=sourceFills(trade),allocations=fills.map((f,i)=>({id:String(i),trade_id:trade.id,quantity:f.quantity,action:f.action,stage_key:'s'+i,source_key:f.key,source_snapshot:f}));
 const plan={definition:{instrument:'stock',direction:'long',currency:'USD',stopPrice:90},management:{}};
 expect(calculateAccountResult(trade,'GBP').pnl).toBeCloseTo(ledger(plan,allocations,[trade]).accountRealisedProfit);
});
test('USD account profit stays USD and requires no broker FX',()=>{
 const t={...example(),pnl:256,commission:4,fees:0};t.executions=t.executions.map(e=>({...e,account_currency:'USD',broker_fx_rate:null}));
 expect(calculateAccountResult(t,'USD')).toMatchObject({currency:'USD',pnl:256,basis:'account_native'});
});
test('unknown transaction FX or contradictory account metadata is explicit, not current-rate conversion',()=>{
 const t=example();t.executions[1].broker_fx_rate=null;expect(calculateAccountResult(t,'GBP')).toMatchObject({status:'unavailable',pnl:null});
 expect(calculateAccountResult(example(),'EUR').status).toBe('unavailable');
});
test('single leg options respect contract multiplier',()=>{
 const t=example();t.instrument_type='option';t.contract_size=100;t.executions=[fill('buy',1,2,1.25,'2026-01-01T10:00:00Z'),fill('sell',1,3,1.2,'2026-01-02T10:00:00Z')];t.commission=0;t.fees=0;
 expect(calculateAccountResult(t,'GBP').pnl).toBeCloseTo(90);
});

test('grouped account-native round trips keep fees and exit events consistent',()=>{
 const trade={id:'group',side:'long',original_currency:'USD',instrument_type:'stock',entry_price:100,exit_price:110,quantity:2,pnl:18,commission:2,fees:0,executions:[{entryPrice:100,exitPrice:110,quantity:2,entryTime:'2026-01-01T10:00:00Z',exitTime:'2026-01-02T10:00:00Z',commission:2}]};
 const result=calculateAccountResult(trade,'USD');expect(result.pnl).toBe(18);expect(result.events[0].pnl).toBe(18);expect(result.events[0].gross_pnl).toBe(20);
});
test('short trade uses each transaction rate with reversed cash direction',()=>{
 const trade={...example(),side:'short',commission:0,fees:0,executions:[fill('sell',2,100,1.25,'2026-01-01T10:00:00Z'),fill('buy',2,90,1.2,'2026-01-02T10:00:00Z')]};
 expect(calculateAccountResult(trade,'GBP').pnl).toBe(10);
});
test('a converted account-native import restores preserved transaction amounts',()=>{
 const trade={...example(),original_currency:'GBP',original_entry_price_currency:80,exchange_rate:1.25,commission:0,fees:0,executions:[{action:'buy',quantity:1,price:100,datetime:'2026-01-01T10:00:00Z'},{action:'sell',quantity:1,price:125,datetime:'2026-01-02T10:00:00Z'}]};
 expect(calculateAccountResult(trade,'GBP').pnl).toBe(20);
});


test('single-exit native broker cash result is authoritative over price arithmetic',()=>{
 const trade={id:'cash',broker:'etoro',side:'long',original_currency:'USD',instrument_type:'stock',entry_price:100,exit_price:110,quantity:2,pnl:47,commission:2,fees:1,exit_time:'2026-01-02T10:00:00Z',executions:[{action:'buy',price:100,quantity:2,datetime:'2026-01-01T10:00:00Z'},{action:'sell',price:110,quantity:2,datetime:'2026-01-02T10:00:00Z'}]};
 const before=structuredClone(trade);const result=calculateAccountResult(trade,'USD');expect(result.events).toEqual([{sourceIndex:1,time:'2026-01-02T10:00:00Z',pnl:47,gross_pnl:50}]);expect(result.pnl).toBe(47);expect(trade).toEqual(before);
});
test('metadata-only native imports retain stored cash at their recorded exit time',()=>{
 const result=calculateAccountResult({original_currency:'USD',pnl:15,commission:1,fees:0,exit_time:'2026-01-02T10:00:00Z',executions:[{notes:'synthetic broker reconciliation'}]},'USD');expect(result.events).toEqual([{time:'2026-01-02T10:00:00Z',pnl:15,gross_pnl:16}]);
});
