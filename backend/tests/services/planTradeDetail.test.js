jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const db=require('../../src/config/database');
const {projectPlanTrade,resolvePlanTrade}=require('../../src/services/planTradeDetail');
const plan={id:'plan',definition:{title:'Synthetic',thesis:'Synthetic plan',stopPrice:90,currency:'USD',setup:'Pullback'}};
const source={id:'source',user_id:'owner',entry_price:55,exit_price:65,quantity:99,pnl:999};
function record(id,action,q,price,time){return {id,trade_id:id,stage_key:action==='entry'?'a':'b',action,quantity:q,valid:true,realisedProfit:action==='exit'?q*20:null,accountRealisedProfit:action==='exit'?q*16:null,fill:{quantity:q,price,time,currency:'USD',multiplier:1,tradeSide:'long',costs:0,commission:0,fees:0,transactionFx:{rate:1.25,accountCurrency:'GBP'}}};}
const result=()=>({records:[record('one','entry',2,100,'2026-01-01'),record('two','entry',3,100,'2026-01-01'),record('three','entry',5,110,'2026-01-02'),record('four','exit',4,120,'2026-01-03'),record('five','exit',3,130,'2026-01-04')],coverageComplete:true,entered:10,openQuantity:3,currency:'USD',realisedProfit:140,percentGain:14,accountCurrency:'GBP',accountRealisedProfit:112,accountEntryCost:840});
beforeEach(()=>db.query.mockReset());
test('detail combines same-row source partitions, retains all buys/sells and uses allocated units',()=>{const r=result(),before=JSON.stringify(source);const t=projectPlanTrade(source,plan,r);expect(t.executions).toHaveLength(4);expect(t.executions.map(e=>[e.action,e.quantity])).toEqual([['buy',5],['buy',5],['sell',4],['sell',3]]);expect(t.entry_price).toBe(105);expect(t.exit_time).toBeNull();expect(t.quantity).toBe(10);expect(t.pnl).toBe(140);expect(t.account_pnl_result.pnl).toBe(112);expect(t.account_pnl_result.events.map(e=>e.sourceIndex)).toEqual([2,3]);expect(JSON.stringify(source)).toBe(before)});
test('fully exited detail spans every linked execution',()=>{const r=result();r.economicallyClosed=true;r.openQuantity=0;const t=projectPlanTrade(source,plan,r);expect(t.entry_time).toBe('2026-01-01');expect(t.exit_time).toBe('2026-01-04');expect(t.exit_price).toBeCloseTo(870/7)});
test.each(['unresolved','overExit'])('changed or invalid %s evidence cannot be silently plotted',field=>{const r=result();r[field]=1;expect(()=>projectPlanTrade(source,plan,r)).toThrow(/Reconcile/)});
test('public readers cannot request private plan context',async()=>{await expect(resolvePlanTrade({user:{id:'other'},query:{planId:'plan'}},source)).rejects.toThrow(/not found/);expect(db.query).not.toHaveBeenCalled()});
test('original record and raw edit paths bypass aggregation',async()=>{for(const query of [{source:'1'},{raw_currency:'1'}])expect(await resolvePlanTrade({user:{id:'owner'},query},source)).toBe(source);expect(db.query).not.toHaveBeenCalled()});
test('ambiguous associations are not merged without explicit plan context',async()=>{db.query.mockResolvedValue({rows:[{id:'a'},{id:'b'}]});expect(await resolvePlanTrade({user:{id:'owner'},query:{}},source)).toBe(source);expect(db.query).toHaveBeenCalledTimes(1)});

test('verified execution prices remain viewable when broker costs are unassigned, without fabricated profit',()=>{const r=result();r.costsUnresolved=1;r.coverageComplete=false;r.realisedProfit=null;r.accountRealisedProfit=null;r.records.filter(x=>x.action==='exit').forEach(x=>{x.realisedProfit=null;x.accountRealisedProfit=null});const t=projectPlanTrade(source,plan,r);expect(t.executions).toHaveLength(4);expect(t.plan_trade.evidenceWarning).toMatch(/costs/);expect(t.pnl).toBeNull();expect(t.account_pnl_result.status).toBe('unavailable');expect(t.executions.filter(x=>x.action==='sell').every(x=>x.realized_pnl===null)).toBe(true)});
test('unverified or provisional coverage still cannot be plotted',()=>{for(const change of [{coverageComplete:false},{costsUnresolved:1,provisionalCount:1},{costsUnresolved:1,currency:null}])expect(()=>projectPlanTrade(source,plan,{...result(),...change})).toThrow(/Reconcile/)});

test('plan-linked chart uses the current asset ticker while preserving broker source identity',()=>{const original={...source,symbol:'LOKB',underlying_symbol:null},p={...plan,definition:{...plan.definition,symbol:'NVTS',instrument:'stock'}};const before=JSON.stringify(original);const t=projectPlanTrade(original,p,result());expect(t.symbol).toBe('NVTS');expect(t.underlying_symbol).toBe('NVTS');expect(t.plan_trade.sourceSymbol).toBe('LOKB');expect(t.plan_trade.sourceTradeId).toBe(original.id);expect(JSON.stringify(original)).toBe(before);expect(t.executions.map(e=>e.source_trade_ids)).toEqual([['one','two'],['three'],['four'],['five']])});
test('option plan retains the contract symbol and uses the planned underlying for charts',()=>{const original={...source,symbol:'OPTION-CONTRACT',underlying_symbol:'OLD'},p={...plan,definition:{...plan.definition,symbol:'NVTS',instrument:'option'}};const t=projectPlanTrade(original,p,result());expect(t.symbol).toBe('OPTION-CONTRACT');expect(t.underlying_symbol).toBe('NVTS')});

test('projected plan prices cannot inherit a broker imports FX recovery markers',()=>{
 const original={...source,original_currency:'GBP',original_entry_price_currency:80,original_exit_price_currency:90,original_pnl_currency:10,exchange_rate:1.25,native_prices:{entry_price:80}};
 const t=projectPlanTrade(original,plan,result());
 expect(t.entry_price).toBe(105);
 for(const key of ['original_entry_price_currency','original_exit_price_currency','original_pnl_currency','exchange_rate','native_prices'])expect(t[key]).toBeNull();
 expect(original.exchange_rate).toBe(1.25);
});

test('GBP projected plan prices and native chart snapshots agree despite imported USD FX provenance',()=>{
 const original={...source,original_currency:'GBP',original_entry_price_currency:80,original_exit_price_currency:90,original_pnl_currency:10,exchange_rate:1.25};
 const r=result();r.currency='GBP';r.records.forEach(record=>record.fill.currency='GBP');
 const t=projectPlanTrade(original,{...plan,definition:{...plan.definition,currency:'GBP'}},r);
 require('../../src/utils/tradePriceDisplay').attachNativeTradePrices(t);
 expect(t.price_currency).toBe('GBP');expect(t.native_prices.entry_price).toBe(105);expect(t.native_prices.executions[0].price).toBe(100);
 expect(t.pnl).toBe(140);expect(original.exchange_rate).toBe(1.25);
});


function gridFixture(){
 const p={id:'00000000-0000-4000-8000-000000000002',user_id:'owner',definition:{title:'Synthetic grid',symbol:'TEST',instrument:'stock',direction:'long',currency:'USD',accountId:'account',stopPrice:80,entries:[{key:'old'},{key:'level'}],exits:[{key:'take'}]},management:{entry:{},exit:{take:{entryMatches:[{entryKey:'level',quantity:2}]}}},baseline:{riskBudget:100,currency:'USD'}};
 const trades=[['old',100,'2026-01-01','buy',2],['level',90,'2026-01-02','buy',4],['sale',110,'2026-01-03','sell',2]].map(([id,price,time,action,quantity])=>({id,user_id:'owner',account_identifier:'synthetic',side:'long',symbol:'TEST',instrument_type:'stock',original_currency:'USD',commission:0,fees:0,executions:[{id,action,quantity,price,datetime:time+'T10:00:00Z',commission:0,fees:0}]}));
 const {sourceFills}=require('../../src/services/planningLedger');const allocations=trades.map(t=>{const f=sourceFills(t)[0];return {id:t.id,trade_id:t.id,source_key:f.key,stage_key:t.id==='sale'?'take':t.id,action:f.action,quantity:f.quantity,source_snapshot:f}});
 return {p,trades,allocations};
}
async function resolveGrid(f){
 const enrich=jest.spyOn(require('../../src/services/planningCashflows'),'enrich').mockImplementation(async(c,p,result)=>result);
 db.query.mockResolvedValueOnce({rows:[f.p]}).mockResolvedValueOnce({rows:f.allocations}).mockResolvedValueOnce({rows:f.trades});
 try{return await resolvePlanTrade({user:{id:'owner'},query:{planId:f.p.id}},f.trades[0])}finally{enrich.mockRestore()}
}
test('combined detail uses saved grid entry matches rather than rejecting several eligible entries',async()=>{
 const f=gridFixture(),before=JSON.stringify(f);const t=await resolveGrid(f);
 expect(t.plan_trade.id).toBe(f.p.id);expect(t.pnl).toBe(40);expect(t.quantity).toBe(6);expect(t.executions).toHaveLength(3);expect(JSON.stringify(f)).toBe(before);
});
test('combined detail retains linked rows added in management and their saved matches',async()=>{
 const f=gridFixture();f.p.definition.entries=[{key:'old'}];f.p.definition.exits=[];f.p.management.entry.level={stage:{label:'Added level'}};f.p.management.exit.take.stage={label:'Added target'};
 const t=await resolveGrid(f);expect(t.pnl).toBe(40);expect(t.executions.map(e=>e.stage_key)).toEqual(['old','level','take']);
});
test('combined detail excludes unlinked manual executions while keeping saved matches and normal ledger previews',async()=>{
 const f=gridFixture();f.p.management.entry.manual={stage:{label:'Manual preview'},executed:true,units:9,price:60,time:'2026-01-01T11:00:00Z'};
 expect(require('../../src/services/planningLedger').ledger(f.p,f.allocations,f.trades).provisionalCount).toBe(1);
 const t=await resolveGrid(f);expect(t.quantity).toBe(6);expect(t.pnl).toBe(40);expect(t.executions.some(e=>e.stage_key==='manual')).toBe(false);
});
test('combined detail still rejects an incomplete explicit grid match',async()=>{
 const f=gridFixture();f.p.management.exit.take.entryMatches=[{entryKey:'level',quantity:1}];await expect(resolveGrid(f)).rejects.toThrow(/Reconcile/);
});
