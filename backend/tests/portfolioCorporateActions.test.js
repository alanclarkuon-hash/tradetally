jest.mock('../src/config/database',()=>({query:jest.fn()}));
const {historySymbol,historySplits,historicalMarketSymbol}=require('../src/services/portfolioCorporateActions');
const {replayShares}=require('../src/services/portfolioReconstructionService');
test('old permanent broker key maps to DNA only after the name change',()=>{
 expect(historySymbol('SRNG','2024-01-01')).toBe('DNA');
 expect(historySymbol('SRNG','2021-09-16')).toBe('SRNG');
 expect(historySymbol('MSFT','2024-01-01')).toBe('MSFT');
});
test('uses continuous Yahoo histories for permanent Facebook and Square broker keys',()=>{
 expect(historySymbol('FB','2024-05-10')).toBe('META');
 expect(historySymbol('SQ','2024-05-10')).toBe('XYZ');
 const rows=replayShares([{date:'2024-05-10',symbol:historySymbol('FB','2024-05-10'),quantity:2},
 {date:'2024-06-01',symbol:historySymbol('FB','2024-06-01'),quantity:-2}],[],'2024-05-10','2024-06-01');
 expect(rows[0].quantities.META).toBe(2);
 expect(rows.at(-1).quantities.META).toBe(0);
});
test('maps confirmed Rheinmetall, SoFi and Ubiquiti keys to their Yahoo histories',()=>{
 expect(historySymbol('RHMD_EQ','2024-05-10')).toBe('RHM.DE');
 expect(historySymbol('IPOE','2024-05-10')).toBe('SOFI');
 expect(historySymbol('UBNT','2024-05-10')).toBe('UI');
});
test('eToro IOTA aliases and Berkshire share class use the correct provider symbol',()=>{
 expect(historicalMarketSymbol('MIOTA','crypto','2024-01-01')).toBe('IOTA-USD');
 expect(historicalMarketSymbol('MIOT','crypto','2024-01-01')).toBe('IOTA-USD');
 expect(historicalMarketSymbol('BTC','crypto','2024-01-01')).toBe('BTC-USD');
 expect(historicalMarketSymbol('BRK.B','stock','2024-01-01')).toBe('BRK-B');
 expect(historicalMarketSymbol('NVTKL.L','stock','2024-01-01')).toBe('NVTKL.L');
});
test('reverse splits reconcile later sales without zeroing pre-delisting holdings',()=>{
 const fills=[{date:'2024-06-01',symbol:'TWOU',quantity:60},{date:'2024-10-01',symbol:'TWOU',quantity:-2}];
 const rows=replayShares(fills,historySplits('TWOU').map(s=>({...s,symbol:'TWOU'})),'2024-06-01','2024-10-02');
 expect(rows[0].quantities.TWOU).toBe(60);
 expect(rows.find(r=>r.date==='2024-06-14').quantities.TWOU).toBe(2);
 expect(rows.at(-1).quantities.TWOU).toBe(0);
});
test('DNA split is applied once when the provider already supplies it',()=>{
 const provider=[{date:'2024-08-20',ratio:1/40}];
 const splits=historySplits('DNA',provider);
 expect(splits).toHaveLength(1);
 const rows=replayShares([{date:'2024-08-01',symbol:'DNA',quantity:80},{date:'2025-01-01',symbol:'DNA',quantity:-2}],splits.map(s=>({...s,symbol:'DNA'})),'2024-08-01','2025-01-01');
 expect(rows.at(-1).quantities.DNA).toBe(0);
 expect(provider).toEqual([{date:'2024-08-20',ratio:1/40}]);
});
