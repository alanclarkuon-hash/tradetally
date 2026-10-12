const {settlements}=require('../../src/services/trading212Settlements');
const {sourceFills,ledger}=require('../../src/services/planningLedger');
const {calculateAccountResult}=require('../../src/services/accountRealisedPnl');
const f=(action,q,price,time,id,fees=0)=>({action,quantity:q,price,datetime:time,order_id:id,account_currency:'GBP',broker_fx_rate:2,fees});
const t=(id,executions)=>({id,broker:'trading212',account_identifier:'synthetic',symbol:'EXAMPLE',side:'long',instrument_type:'stock',original_currency:'USD',quantity:executions[0].quantity,entry_price:executions[0].price,pnl:executions.length>1?1:null,exit_time:executions[1]?.datetime,fees:executions.reduce((s,e)=>s+e.fees,0),commission:0,executions});
const example=()=>[t('closed',[f('buy',1,100,'2026-01-01','buy1',.2),f('sell',1,140,'2026-01-03','sell',.4)]),t('open',[f('buy',1,100,'2026-01-01','buy1',.2)]),t('later',[f('buy',2,120,'2026-01-02','buy2',.4)])];
test('pooled cost includes later buys and reconstructs split entry once without changing source rows',()=>{
 const rows=example(),before=structuredClone(rows),r=settlements(rows).get('closed');
 expect(r.events[0].gross_pnl).toBe(15);expect(r.pnl).toBeCloseTo(14.7);expect(rows).toEqual(before);
 rows[0].broker_settlement=r;expect(calculateAccountResult(rows[0],'GBP').pnl).toBeCloseTo(14.7);
 const allocations=sourceFills(rows[0]).map((f,i)=>({id:String(i),trade_id:'closed',action:f.action,quantity:f.quantity,source_key:f.key,stage_key:'row',source_snapshot:f}));
 expect(ledger({definition:{instrument:'stock',direction:'long',currency:'USD',stopPrice:90},management:{}},allocations,rows).accountRealisedProfit).toBeCloseTo(14.7);
});
test('authoritative broker Result overrides reconstructed gross, including zero',()=>{
 const rows=example();rows[0].executions[1].broker_result=0;rows[0].executions[1].broker_result_currency='GBP';expect(settlements(rows).get('closed').pnl).toBeCloseTo(-.3);
});
test('sale split across FIFO records is attributed proportionally without duplicating result',()=>{
 const rows=example();rows[0].executions[1].quantity=.5;rows[0].executions[0].quantity=.5;rows[0].executions[0].fees=.1;rows[0].executions[1].fees=.2;rows[0].fees=.3;
 const slice=structuredClone(rows[0]);slice.id='slice';rows.push(slice);
 const out=settlements(rows);expect(out.get('closed').events[0].gross_pnl+out.get('slice').events[0].gross_pnl).toBe(15);
});
test('incomplete FX or over-exit history cannot silently return FIFO settlement',()=>{
 const rows=example();rows[0].executions[0].broker_fx_rate=null;expect(settlements(rows).get('closed').status).toBe('unavailable');
});
