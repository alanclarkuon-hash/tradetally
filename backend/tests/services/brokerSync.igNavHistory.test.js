jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const {readSpreadStatement,savePoint}=require('../../src/services/brokerSync/igNavHistory');
const base={kind:'spread_bet',statementMask:'S***1',statementLabel:'Synthetic',confirmation:{cutoff:'2026-10-03T10:00:00Z'}};
const report={from_date:'2026-01-01',starting_cash:0,records:[{time:'2026-08-19T12:00:00Z',cash:100}]};
const text='20 August 2026\nAccount No. S***1\nAccount Name Synthetic\nFunds 100.00\nRunning Profit Or Loss -2.00\nEquity 98.00\nTotal Long Positions 10000.00';
test('uses reported equity and signed running P&L, not notional exposure',()=>{
 expect(readSpreadStatement(text,base,report)).toEqual({date:'2026-08-20',cash:100,holdings:-2});
});
test.each(['identity','equity','cash','date'])('rejects conflicting %s evidence',kind=>{
 const changed=kind==='identity'?text.replace('S***1','S***2'):kind==='equity'?text.replace('Equity 98.00','Equity 99.00'):kind==='cash'?text.replace('Funds 100.00','Funds 101.00').replace('Equity 98.00','Equity 99.00'):text.replace('20 August','31 February');
 expect(()=>readSpreadStatement(changed,base,report)).toThrow();
});
test('saves statement priority values with dated GBP conversion and no cash transactions',async()=>{
 const client={query:jest.fn().mockResolvedValueOnce({rows:[{rates:{GBP:.8}}]}).mockResolvedValue({rows:[]})};
 await savePoint(client,'user','synthetic',{date:'2026-08-20',cash:100,holdings:-2});
 expect(client.query.mock.calls[1][0]).toContain('ON CONFLICT');
 expect(client.query.mock.calls[1][1]).toEqual(['user','synthetic','2026-08-20',-2.5,125,.8]);
});
