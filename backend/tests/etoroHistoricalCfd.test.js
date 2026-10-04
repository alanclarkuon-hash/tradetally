const {cfdEquity}=require('../src/services/etoroHistoricalCfd');
const lot={quantity:2,entry_price:40,side:'long',executions:[{type:'entry',etoro_leverage:1,etoro_native_price:40}]};
test('one-times CFD equity matches collateral plus price movement',()=>{
 expect(cfdEquity(lot,2,55,1)).toBe(110);
});
test('leveraged and short CFDs count collateral, not full exposure',()=>{
 const leveraged={...lot,executions:[{...lot.executions[0],etoro_leverage:2}]};
 expect(cfdEquity(leveraged,2,55,1)).toBe(70);
 expect(cfdEquity({...leveraged,side:'short'},2,55,1)).toBe(10);
});
test('split quantities preserve opening notional rather than using adjusted entry against old units',()=>{
 expect(cfdEquity({...lot,quantity:20,entry_price:4,executions:[{...lot.executions[0],etoro_native_price:4}]},2,40,1)).toBe(80);
});
test('converts only native P&L at dated FX, keeping USD collateral and normalizing pence',()=>{
 expect(cfdEquity({...lot,entry_price:50},2,55,1.5)).toBe(145);
 expect(cfdEquity({...lot,entry_price:50,executions:[{...lot.executions[0],etoro_native_price:4000}]},2,55,1.5,{nativeDivisor:100})).toBe(145);
});
test('missing price, leverage or unproven entry rate cannot create a value',()=>{
 expect(cfdEquity(lot,2,null,1)).toBeNull();
 expect(cfdEquity({...lot,executions:[]},2,55,1)).toBeNull();
 expect(cfdEquity({...lot,executions:[{type:'entry',etoro_leverage:1}]},2,55,1)).toBeNull();
});
