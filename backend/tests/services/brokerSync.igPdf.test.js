jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const {confirmation,identity}=require('../../src/services/brokerSync/igPdf');
const base={kind:'spread_bet',ledgerAccountId:'SYNTH1',statementMask:'S***1',statementLabel:'Synthetic',confirmation:{cutoff:'2026-05-01T00:00:00Z',holdings:[]}};
const trading='03 June 2026\nAccount No. S***1\nAccount Name Synthetic\nFunds 25.00\nRunning Profit Or Loss 0.00\nTotal Long Positions 0.00\nTotal Short Positions 0.00';
const ledger='AccountId: SYNTH1\nLedger Hi st or y St at ement';
const csv='TextDate,DateUtc,PL Amount\n,2026-06-01T12:00:00,25.00';
test('reads a GBP cash checkpoint and zero spread-bet position statement',()=>{
  expect(identity(trading,ledger)).toEqual({ledgerId:'SYNTH1',mask:'S***1',label:'Synthetic'});
  expect(confirmation(base,trading,ledger,csv)).toMatchObject({cash:25,holdings:[]});
});
test.each(['identity','balance','open positions','older'])('rejects %s statement before import',kind=>{
  let t=trading,b=base;
  if(kind==='identity')t=t.replace('S***1','S***2');
  if(kind==='balance')t=t.replace('25.00','26.00');
  if(kind==='open positions')t=t.replace('Total Long Positions 0.00','Total Long Positions 1.00');
  if(kind==='older')b={...base,confirmation:{...base.confirmation,cutoff:'2026-07-01T00:00:00Z'}};
  expect(()=>confirmation(b,t,ledger,csv)).toThrow(/IG upload:/);
});
test('uses previous-day share balance before the next morning interest and retains original share identity',()=>{
  const b={...base,kind:'share_dealing',confirmation:{...base.confirmation,holdings:[{symbol:'SYN.L',isin:'GB0000000001',name:'Synthetic',cost:2,quantity:1,value:3,asOf:'2026-05-01T00:00:00Z'}]}};
  const t='01 Jun 2026\nAccount No. S***1\nAccount Name Synthetic\nCash balance GBP 25.00\nValue of GBP assets 3.00\nSYNTHETIC GB0000000001 1 2.00 3.00 3.00 1.00 50.00';
  const c='TextDate,DateUtc,PL Amount\n,2026-05-31T12:00:00,25.00\n,2026-06-01T04:00:00,1.00';
  const result=confirmation(b,t,ledger,c);
  expect(result).toMatchObject({cash:25,cutoff:'2026-05-31T22:59:59.999Z',holdings:[{symbol:'SYN.L',cost:2,value:3,name:'Synthetic'}]});
});
