jest.mock('../../src/config/database',()=>({}));
jest.mock('../../src/services/analyticsCache',()=>({}));
const {planClassifications}=require('../../src/services/brokerSync/etoroClassifications');
const row=(Type='CFD',id='1')=>({'Position ID':id,Action:'Example (TEST)',Type,'Long / Short':'Long','Units / Contracts':2,Leverage:1,Amount:20,'FX rate at open (USD)':'-','FX rate at close (USD)':'-','Open Rate':10,'Close Rate':12,'Profit(USD)':4,'Open Date':'01/01/2026 12:00:00','Close Date':'02/01/2026 12:00:00','Copied From':'-'});
const trade=(instrument_type='stock',id='1')=>({id:'trade'+id,symbol:'TEST',side:'long',instrument_type,quantity:2,pnl:4,entry_time:'2026-01-01T12:00:00.123Z',exit_time:'2026-01-02T12:00:00.456Z',executions:[{etoro_position_id:id,price:10},{etoro_position_id:id,price:12}]});
test.each([['Stocks','stock'],['ETF','stock'],['Crypto','crypto'],['CFD','cfd']])('verifies %s against exact broker identity and preserves execution prices',(Type,expected)=>{
 const t=trade();const result=planClassifications({'Closed Positions':[row(Type)]},[t]);expect(result.counts.verified).toBe(1);expect(result.updates[0].instrument).toBe(expected);expect(result.updates[0].executions.map(e=>e.price)).toEqual([10,12]);expect(t.instrument_type).toBe('stock');
 const corrected={...t,instrument_type:expected,executions:result.updates[0].executions};expect(planClassifications({'Closed Positions':[row(Type)]},[corrected]).updates).toEqual([]);
});
test('unmatched positions are counted without creating trades; duplicate exact matches stop',()=>{
 expect(planClassifications({'Closed Positions':[row()]},[]).counts.unmatched).toBe(1);
 expect(()=>planClassifications({'Closed Positions':[row()]},[trade(),{...trade(),id:'other'}])).toThrow(/multiple/);
});
test('financial discrepancies, unsupported types and conflicting product evidence stop',()=>{
 expect(()=>planClassifications({'Closed Positions':[row()]},[{...trade(),pnl:8}])).toThrow(/differs/);
 expect(()=>planClassifications({'Closed Positions':[row('Unknown')]},[trade()])).toThrow(/Unidentified/);
 const t=trade();t.executions[0].etoro_source_type='Crypto';expect(()=>planClassifications({'Closed Positions':[row()]},[t])).toThrow(/Conflicting/);
});
test('correcting a linked instrument reports each affected plan and changes source revision',()=>{
 const t=trade(),s={'Closed Positions':[row()]};const a=[{id:'a',trade_id:t.id,plan_id:'p'}];const r=planClassifications(s,[t],a);expect(r.counts).toMatchObject({corrected:1,affectedPlans:1});expect(planClassifications(s,[{...t,pnl:4.01}],a).revision).not.toBe(r.revision);
});

test('unique broker position identity verifies historical ticker renames without changing stored symbols or profit',()=>{const t=trade(),s={'Closed Positions':[row()]};t.symbol='OLD';const result=planClassifications(s,[t]);expect(result.counts.verified).toBe(1);expect(result.updates[0].executions.every(e=>e.etoro_statement_symbol==='TEST')).toBe(true);expect(t.symbol).toBe('OLD');expect(result.updates[0]).not.toHaveProperty('symbol');expect(()=>planClassifications(s,[t,{...t,id:'duplicate'}])).toThrow(/multiple/);expect(()=>planClassifications(s,[{...t,quantity:999}])).toThrow(/differs/);});
