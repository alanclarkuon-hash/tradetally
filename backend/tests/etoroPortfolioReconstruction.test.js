jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/services/portfolioDashboardService',()=>({FIAT:new Set(['USD','GBP']),STABLE:new Set(['USDT'])}));
jest.mock('../src/utils/quoteCurrency',()=>({normaliseMinorUnit:c=>c?{code:c,divisor:1}:null}));
jest.mock('../src/services/brokerSync/etoroCashStatement',()=>({loadLedger:jest.fn()}));
const db=require('../src/config/database');
const ledger=require('../src/services/brokerSync/etoroCashStatement');
const {reconstruct}=require('../src/services/portfolioReconstructionService');
test('reconstruction uses CFD equity and keeps commodity stock collisions as zero estimates',async()=>{
 jest.useFakeTimers({now:new Date('2024-01-04T12:00:00Z')});
 const lot={symbol:'TEST',instrument_type:'cfd',side:'long',entry_time:'2024-01-01T10:00:00Z',quantity:2,entry_price:40,executions:[{type:'entry',etoro_position_id:'synthetic',etoro_native_price:40,etoro_leverage:2}]};
 db.query.mockImplementation(async sql=>{
  if(sql.includes('FROM user_accounts'))return {rows:[{id:'account',account_identifier:'synthetic-account',broker:'etoro',currency:'USD',initial_balance_date:'2024-01-01',initial_balance:0}]};
  if(sql.includes('FROM trades'))return {rows:[lot,{...lot,symbol:'GOLD'}]};
  if(sql.includes('FROM fx_daily_rates'))return {rows:[{rate_date:'2024-01-01',rates:{GBP:.8}}]};
  if(sql.includes('FROM portfolio_reconstruction_prices'))return {rows:[{payload:{from:'2024-01-01',to:'2024-01-03',currency:'USD',prices:[{date:'2024-01-01',close:40},{date:'2024-01-02',close:50},{date:'2024-01-03',close:45}],splits:[]}}]};
  return {rows:[]};
 });
 ledger.loadLedger.mockResolvedValue({rows:[{date:'2024-01-01',balance:100}],openingBalance:0,report:{to_date:'2024-01-03'}});
 const result=await reconstruct('synthetic-owner',{broker:'etoro',zeroMissingPrices:true});
 expect(result[0]).toMatchObject({days:3,gaps:0,estimatedDays:3});
 expect(result[0].issues).toEqual(['Estimated at zero: missing historical price for GOLD']);
 // Also verify amounts reaching persistence, not only summary coverage.
 const persisted=[];
 db.withTransaction=async fn=>fn({query:async(sql,args)=>{if(sql.startsWith('INSERT INTO portfolio_reconstructed_values'))persisted.push(args);return {rows:[]};}});
 await reconstruct('synthetic-owner',{broker:'etoro',zeroMissingPrices:true,apply:true});
 expect(persisted.map(args=>args[3])).toEqual([40,60,50]);
 expect(persisted.map(args=>args[4])).toEqual([100,100,100]);
 jest.useRealTimers();
});
