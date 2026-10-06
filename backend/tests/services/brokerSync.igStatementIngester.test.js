jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const db=require('../../src/config/database'),service=require('../../src/services/brokerSync/igStatementIngester');
test('FX rounding does not turn a duplicate GBP valuation into a conflict',()=>{
 expect(service.samePoint({cash_usd:'123.45678901',holdings_usd:'2.5000000001',gbp_per_usd:'.81'},{cash:100,holdings:2.03})).toBe(true);
 expect(service.samePoint({cash_usd:125,holdings_usd:2.5,gbp_per_usd:.8},{cash:101,holdings:2})).toBe(false);
});
test('a durable receipt prevents retrying already imported financial data',async()=>{
 db.query.mockResolvedValue({rows:[{status:'imported'}]});
 const result=await service.ingest('synthetic',Buffer.from('%PDF synthetic'),{statementDate:'2026-10-05'});
 expect(result.status).toBe('duplicate');expect(db.query).toHaveBeenCalledTimes(1);db.query.mockClear();
});
test('status is user scoped and replaces internal reasons with safe messages',async()=>{
 db.query.mockResolvedValue({rows:[{id:'synthetic',status:'review',reason:'activity_pending',statement_date:'2026-10-05'}]});
 const result=await service.status('owner');expect(db.query.mock.calls[0][1]).toEqual(['owner']);expect(result.documents[0].reason).toContain('Portfolio valuation imported');
});
test('cash-date conflicts remain visible even though the original PDF receipt was imported',async()=>{
 db.query.mockResolvedValue({rows:[{status:'imported',reason:'cash_date_conflict'}]});
 const result=await service.status('owner');expect(result.documents[0].needsReview).toBe(true);expect(result.documents[0].reason).toContain('conflicting chart value is excluded');
});
