jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../src/services/brokerSync/igPdf',()=>({text:jest.fn().mockResolvedValue('synthetic')}));
jest.mock('../../src/services/brokerSync/igDailyStatement',()=>({dateFromName:()=>null,identity:()=>({mask:'unknown',label:'Synthetic'}),parse:jest.fn(),fail:reason=>{const e=Error(reason);e.igReason=reason;throw e;}}));
jest.mock('../../src/utils/currencyConverter',()=>({getRateMap:jest.fn().mockResolvedValue({GBP:1})}));
jest.mock('../../src/services/backup.service',()=>({createFullSiteBackup:jest.fn().mockResolvedValue({})}));
jest.mock('../../src/services/manualPortfolioMaintenance',()=>({rebuild:jest.fn().mockResolvedValue({failed:false})}));
jest.mock('../../src/services/brokerSync/igNavHistory',()=>({savePoint:jest.fn()}));
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

test('new execution evidence lets a previously reviewed PDF reach backed-up valuation import',async()=>{
 const daily=require('../../src/services/brokerSync/igDailyStatement');
 const base={name:'Synthetic',identity:'demo',kind:'share_dealing',statementMask:'unknown',statementLabel:'Synthetic',transactions:'TextDate,DateUtc,Reference,MarketName,TransactionType,PL Amount,CurrencyIsoCode\nx,2026-10-01T12:00:00,old,Cash Interest Paid,DEPO,0,GBP',confirmation:{cash:0,cutoff:'2026-10-05T23:59:59Z',holdings:[]},shareSecurities:[]};
 inputs=[{account_identifier:'IG SD demo',payload:{igFileInput:base}}];
 daily.parse.mockImplementation((_,date,input)=>{if(!input.shareSecurities.length)daily.fail('new_share_execution_required');return {date,cash:0,holdings:0,positions:[],records:[],activitySupported:true};});
 db.withTransaction.mockImplementation(fn=>fn({query:jest.fn().mockResolvedValue({rows:[]})}));
 expect((await ingest('owner',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-04'})).reason).toBe('new_share_execution_required');
 expect((await ingest('owner',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-04'})).skipped).toBe(true);
 inputs=[{...inputs[0],payload:{igFileInput:{...base,shareSecurities:[{isin:'synthetic-new-execution'}]}}}];
 expect((await ingest('owner',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-04'})).status).toBe('imported');
 expect(require('../../src/services/backup.service').createFullSiteBackup).toHaveBeenCalledTimes(1);
 expect(require('../../src/services/brokerSync/igNavHistory').savePoint).toHaveBeenCalled();
});
