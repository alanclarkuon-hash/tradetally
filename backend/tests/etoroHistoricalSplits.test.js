const {statementSplits,historicalLotQuantity,statementLotMetadata}=require('../src/services/etoroHistoricalSplits');
const trade={symbol:'TEST',quantity:20,executions:[{etoro_position_id:'synthetic-lot'}]};
const records=[{sourceType:'corp action: Split',details:'TEST/USD 10:1',positionId:'synthetic-lot',date:'2024-06-09'}];
const market=[{date:'2024-06-10',ratio:10}];
test('recovers a partial lot from a unique statement opening without changing trade identity',()=>{
 const child={...trade,entry_time:'2024-01-01T10:00:00.500Z',executions:[{etoro_position_id:'child'}]};
 const metadata=statementLotMetadata([child],[{sourceType:'Open Position',positionId:'synthetic-lot',details:'TEST/USD',time:'2024-01-01T10:00:00.000Z'}],statementSplits(records)).get(child);
 expect(historicalLotQuantity(child,'2024-06-01','2024-01-01',null,metadata.splits,market)).toBe(2);
 expect(metadata.currency).toBe('USD');
 expect(child.executions[0].etoro_position_id).toBe('child');
});
test('conflicting simultaneous opening allocations stay unresolved',()=>{
 const child={...trade,entry_time:'2024-01-01T10:00:00Z',executions:[{etoro_position_id:'child'}]};
 const openings=['synthetic-lot','other'].map(positionId=>({positionId,sourceType:'Open Position',details:'TEST/USD',time:'2024-01-01T10:00:00Z'}));
 expect(statementLotMetadata([child],openings,statementSplits(records)).get(child).splits).toEqual([]);
 const all=statementSplits([...records,{...records[0],positionId:'other'}]);
 expect(statementLotMetadata([child],openings,all).get(child).splits).toHaveLength(1);
});
test('deduplicates overlapping statements and retains position allocation',()=>{
 expect(statementSplits([...records,...records])).toHaveLength(1);
 expect(statementSplits([{...records[0],details:'invalid'}])).toEqual([]);
 expect(statementSplits([{...records[0],details:'GSK.l/GBX 1:1'}])[0]).toMatchObject({symbol:'GSK.L',ratio:1});
});
test('undoes splits for historical closed partial lots using market effective dates',()=>{
 const splits=statementSplits(records);
 expect(historicalLotQuantity(trade,'2024-06-09','2024-01-01','2024-07-01',splits,market)).toBe(2);
 expect(historicalLotQuantity(trade,'2024-06-10','2024-01-01','2024-07-01',splits,market)).toBe(20);
 expect(historicalLotQuantity({...trade,quantity:5},'2024-06-01','2024-01-01','2024-07-01',splits,market)).toBe(.5);
});
test('handles reverse splits, multiple splits and current open quantities',()=>{
 const splits=[{positionId:'synthetic-lot',symbol:'TEST',date:'2024-02-01',ratio:.1},{positionId:'synthetic-lot',symbol:'TEST',date:'2024-06-10',ratio:10}];
 expect(historicalLotQuantity(trade,'2024-01-15','2024-01-01',null,splits)).toBe(20);
 expect(historicalLotQuantity(trade,'2024-03-01','2024-01-01',null,splits)).toBe(2);
 expect(historicalLotQuantity(trade,'2024-07-01','2024-01-01',null,splits)).toBe(20);
});
test('partial closures inherit their original position split, applying an event once',()=>{
 const child={...trade,quantity:5,executions:[{etoro_position_id:'child-lot',etoro_parent_position_id:'synthetic-lot'}]};
 const splits=statementSplits([...records,{...records[0],positionId:'child-lot'}]);
 expect(historicalLotQuantity(child,'2024-06-01','2024-01-01','2024-07-01',splits,market)).toBe(.5);
});
test('does not adjust lots already closed or unrelated positions; missing proof stays blocked',()=>{
 expect(historicalLotQuantity(trade,'2024-05-01','2024-01-01','2024-06-01',statementSplits(records),market)).toBe(20);
 expect(historicalLotQuantity(trade,'2024-05-01','2024-01-01',null,[],market)).toBeNull();
 expect(historicalLotQuantity(trade,'2024-07-01','2024-01-01',null,[],market)).toBe(20);
 expect(historicalLotQuantity({...trade,executions:[]},'2024-05-01','2024-01-01',null,statementSplits(records),market)).toBeNull();
});
