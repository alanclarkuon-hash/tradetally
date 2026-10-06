jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerSync/igPdf',()=>({text:jest.fn().mockResolvedValue('synthetic')}));
jest.mock('../../src/services/brokerSync/igDailyStatement',()=>({dateFromName:()=>null,identity:()=>({mask:'unknown',label:'Synthetic'}),fail:reason=>{const e=Error(reason);e.igReason=reason;throw e;}}));
const db=require('../../src/config/database'),pdf=require('../../src/services/brokerSync/igPdf'),{ingest}=require('../../src/services/brokerSync/igStatementIngester');
let prior,inputs;
beforeEach(()=>{
 jest.clearAllMocks();prior={status:'review',reason:'new_share_execution_required',retry_context:null};inputs=[];
 db.query.mockImplementation(async(sql,args)=>{
  if(sql.startsWith('SELECT status,reason'))return {rows:[prior]};
  if(sql.startsWith('SELECT a.account_identifier'))return {rows:inputs};
  if(sql.startsWith('SELECT status FROM'))return {rows:[]};
  if(sql.includes("VALUES($1,$2,'processing',$3)"))prior.retry_context=args[2];
  return {rows:[]};
 });
});
test('changed evidence retries a reviewed PDF once and unchanged evidence does not reparse it',async()=>{
 await ingest('owner',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-05'});
 expect(pdf.text).toHaveBeenCalledTimes(1);
 expect((await ingest('owner',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-05'})).skipped).toBe(true);
 inputs=[{account_identifier:'synthetic',payload:{igFileInput:{newExecution:true}}}];
 await ingest('owner',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-05'});
 expect(pdf.text).toHaveBeenCalledTimes(2);
});
test('a corrected reporting date retries the same attachment without bypassing validation',async()=>{
 await ingest('owner',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-04'});
 await ingest('owner',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-05'});
 expect(pdf.text).toHaveBeenCalledTimes(2);
});
test('valuation conflicts use the guarded reconciliation path rather than automatic PDF retries',async()=>{
 prior.reason='conflicting_statement';
 expect((await ingest('owner',Buffer.from('%PDF synthetic'))).skipped).toBe(true);
 expect(pdf.text).not.toHaveBeenCalled();
});
