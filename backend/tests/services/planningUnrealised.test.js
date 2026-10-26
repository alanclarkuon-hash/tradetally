jest.mock('../../src/services/planningFx',()=>({latestPlanningFx:jest.fn(async()=>({rates:{USD:1,GBP:.8}}))}));
jest.mock('../../src/services/brokerPositionValuations',()=>({readDetailed:jest.fn(async()=>[])}));
const {load}=require('../../src/services/planningUnrealised'),{ledger,sourceFills}=require('../../src/services/planningLedger');
const plan={user_id:'owner',definition:{symbol:'TEST',instrument:'stock',direction:'long',currency:'USD',accountId:'account',entries:[{key:'entry'}],exits:[{key:'exit'}]}};
const date=new Date().toISOString();
const lot=(extra={})=>({q:5,price:100,multiplier:1,feePerUnit:.2,accountPrice:100,accountFeePerUnit:.2,accountCurrency:'USD',accountId:'account',instrument:'stock',side:'long',...extra});
function client({price=110,source='yahoo',snapshots=[]}={}){return {query:jest.fn(async sql=>({rows:sql.includes('FROM user_accounts')?[{id:'account',account_identifier:'synthetic'}]:sql.includes('FROM price_monitoring')?[{symbol:'TEST',current_price:price,last_updated:date,data_source:source}]:snapshots}))}}
const evidence=lots=>({openQuantity:lots.reduce((v,l)=>v+l.q,0),openLots:lots});
test('values only remaining FIFO quantity after partial exits and apportions entry fees once',async()=>{
 const t={id:'t',symbol:'TEST',side:'long',original_currency:'USD',commission:3,fees:0,executions:[{id:'buy',action:'buy',quantity:10,price:100,commission:2,datetime:'2026-01-01'},{id:'sell',action:'sell',quantity:5,price:105,commission:1,datetime:'2026-01-02'}]};const fills=sourceFills(t),allocations=fills.map(f=>({trade_id:'t',source_key:f.key,source_snapshot:f,stage_key:f.action==='entry'?'entry':'exit',action:f.action,quantity:f.quantity})),result=ledger(plan,allocations,[t]);
 const before=result.realisedProfit,r=await load(client(),plan,result);expect(r.status).toBe('available');expect(r.accounts[0].amount).toBeCloseTo(49);expect(result.realisedProfit).toBe(before);expect(result.openLots[0].q).toBe(5);
});
test('short profit reverses price movement and subtracts only remaining entry costs',async()=>{const r=await load(client({price:90}),plan,evidence([lot({side:'short'})]));expect(r.accounts[0].amount).toBe(49)});
test('account FX retains acquisition cost while valuing current proceeds at reporting rates',async()=>{const r=await load(client(),plan,evidence([lot({accountPrice:75,accountCurrency:'GBP',accountFeePerUnit:.1})]));expect(r.accounts[0].amount).toBe(64.5);expect(r.accounts[0].currency).toBe('GBP')});
test('closed positions are zero without querying quotes',async()=>{const c=client();expect((await load(c,plan,{openQuantity:0})).status).toBe('closed');expect(c.query).not.toHaveBeenCalled()});
test.each([{unresolved:1},{overExit:true},{costsUnresolved:1},{provisionalCount:1}])('unverified evidence is unavailable: %p',async extra=>{expect((await load(client(),plan,{...evidence([lot()]),...extra})).status).toBe('unavailable')});
test('missing quote or ambiguous crypto/stock cache cannot fabricate zero P&L',async()=>{expect((await load(client({price:null}),plan,evidence([lot()]))).status).toBe('unavailable');expect((await load(client({source:'coingecko'}),plan,evidence([lot()]))).status).toBe('unavailable')});
test('broker CFD equity is prorated using exact position identity rather than underlying quote',async()=>{
 require('../../src/services/brokerPositionValuations').readDetailed.mockResolvedValueOnce([{positionId:'position',symbol:'TEST',instrumentType:'cfd',currency:'USD',accountIdentifier:'synthetic',quantity:10,capital:1000,value:1200,asOf:date,source:'broker'}]);
 const r=await load(client(),plan,evidence([lot({instrument:'cfd',brokerPositionId:'position',accountFeePerUnit:0})]));expect(r.accounts[0].amount).toBe(100);
});
test('a grouped CFD snapshot cannot be treated as an individual broker position',async()=>{const r=await load(client({snapshots:[{account_identifier:'synthetic',synced_at:date,positions:[{positionId:'position',symbol:'TEST',instrumentType:'cfd',currency:'USD',quantity:10,totalCost:1000,currentValue:1200,lotCount:2}]}]}),plan,evidence([lot({instrument:'cfd',brokerPositionId:'position'})]));expect(r.status).toBe('unavailable')});

test('crypto valuation uses the instrument-scoped crypto cache and respects plan quantity',async()=>{const c={query:jest.fn(async sql=>({rows:sql.includes('FROM user_accounts')?[{id:'account',account_identifier:'synthetic'}]:[{symbol:'crypto:TEST',current_price:120,last_updated:date,data_source:'broker:okx:crypto'}]}))};const r=await load(c,plan,evidence([lot({instrument:'crypto',q:2})]));expect(r.accounts[0].amount).toBeCloseTo(39.6);expect(c.query.mock.calls.find(([sql])=>sql.includes('price_monitoring'))[1]).toEqual([['crypto:TEST']])});
