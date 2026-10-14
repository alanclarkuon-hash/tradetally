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
test('recorded unchanged units override a provider-only adjustment once opening identity is proven',()=>{
 const lot={...trade,entry_time:'2024-01-01T10:00:00Z',entry_price:10};
 const opening={sourceType:'Open Position',positionId:'synthetic-lot',details:'TEST/USD',time:lot.entry_time,units:20,amount:200};
 const meta=statementLotMetadata([lot],[opening],[]).get(lot);
 expect(meta.statementAuthority).toBe(true);
 expect(historicalLotQuantity(lot,'2024-01-01','2024-01-01',null,[],[{date:'2024-01-02',ratio:1.046}],meta)).toBe(20);
});
test('statement quantity and invested cost override a 1:1 label and map the correct London listing',()=>{
 const lot={...trade,symbol:'TEST',quantity:4,entry_price:62.5,entry_time:'2024-01-01T10:00:00Z'};
 const opening={sourceType:'Open Position',positionId:'synthetic-lot',details:'TEST.l/GBX',time:lot.entry_time,units:5,amount:250};
 const events=[{positionId:'synthetic-lot',symbol:'TEST.L',date:'2024-01-02',ratio:1}];
 const meta=statementLotMetadata([lot],[opening],events).get(lot);
 expect(meta).toMatchObject({currency:'GBX',marketSymbol:'TEST.L',statementAuthority:true});
 expect(meta.splits[0].ratio).toBe(.8);
 expect(historicalLotQuantity(lot,'2024-01-01','2024-01-01',null,meta.splits,[{date:'2024-01-02',ratio:1.226}],meta)).toBe(5);
});
test('entry cost can resolve conflicting partial-position split profiles with an independent statement check',()=>{
 const lot={...trade,entry_time:'2024-01-01T10:00:00Z',entry_price:10,executions:[{etoro_position_id:'child'}]};
 const openings=['synthetic-lot','other'].map(positionId=>({positionId,sourceType:'Open Position',details:'TEST/USD',time:lot.entry_time,units:2,amount:200}));
 const meta=statementLotMetadata([lot],openings,statementSplits(records)).get(lot);
 expect(meta.statementAuthority).toBe(true);
 expect(meta.splits[0].ratio).toBe(10);
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

test.each([['de','EUR'],['NV','EUR'],['PA','EUR'],['MI','EUR'],['MC','EUR'],['ZU','CHF'],['SW','CHF'],['ST','SEK'],['CO','DKK'],['ASX','AUD'],['US','USD'],['HK','HKD']])('same-position bare and full %s listing match only with native %s evidence',(suffix,currency)=>{
 const lot={symbol:'SYNTH',instrument_type:'stock',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'synthetic-lot'}]};
 const opening={sourceType:'Open Position',positionId:'synthetic-lot',details:'SYNTH.'+suffix+'/'+currency,time:lot.entry_time,units:2,amount:20};
 const original=JSON.stringify(lot),meta=statementLotMetadata([lot],[opening],[]).get(lot);
 expect(meta).toMatchObject({currency,marketSymbol:('SYNTH.'+suffix).toUpperCase(),statementAuthority:true});
 expect(JSON.stringify(lot)).toBe(original);
});
test.each([['DE','USD'],['ZU','EUR'],['ST','EUR'],['CO','SEK'],['UNKNOWN','EUR']])('currency-conflicting or unverified suffix %s/%s is not stripped',(suffix,currency)=>{
 const lot={symbol:'SYNTH',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'synthetic'}]};
 const opening={sourceType:'Open Position',positionId:'synthetic',details:'SYNTH.'+suffix+'/'+currency,time:lot.entry_time,units:2,amount:20};
 expect(statementLotMetadata([lot],[opening],[]).get(lot)).toMatchObject({currency:null,marketSymbol:null});
});
test('same-time ticker collisions across native venues never select a listing arbitrarily',()=>{
 const lot={symbol:'SYNTH',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'unmatched-child'}]};
 const openings=['DE/EUR','US/USD'].map((suffix,i)=>({sourceType:'Open Position',positionId:'other-'+i,details:'SYNTH.'+suffix,time:lot.entry_time,units:2,amount:20}));
 expect(statementLotMetadata([lot],openings,[]).get(lot)).toMatchObject({currency:null,marketSymbol:null});
});
test('a different full listing or wrong opening time cannot become historical market identity',()=>{
 const lot={symbol:'SYNTH',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'unmatched-child'}]};
 const opening={sourceType:'Open Position',positionId:'other',details:'SYNTH.DE/EUR',time:'2024-01-03T10:00:00Z',units:2,amount:20};
 expect(statementLotMetadata([lot],[opening],[]).get(lot).marketSymbol).toBeNull();
 expect(statementLotMetadata([lot],[{...opening,positionId:'unmatched-child',details:'DIFFERENT.DE/EUR'}],[]).get(lot).marketSymbol).toBeNull();
});

test.each([['DE','EUR'],['ZU','CHF'],['NV','EUR'],['PA','EUR'],['MC','EUR'],['US','USD'],['CO','DKK'],['ST','SEK']])('a bare statement label never discards existing compatible %s listing',(suffix,currency)=>{
 const lot={symbol:'SYNTH.'+suffix,entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'synthetic'}]};
 const opening={sourceType:'Open Position',positionId:'synthetic',details:'SYNTH/'+currency,time:lot.entry_time,units:2,amount:20};
 expect(statementLotMetadata([lot],[opening],[]).get(lot)).toMatchObject({currency,marketSymbol:lot.symbol,statementAuthority:true});
});
test('an unproven same-time opening cannot supply an alias without cost or position authority',()=>{
 const lot={symbol:'SYNTH.DE',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'unmatched'}]};
 const opening={sourceType:'Open Position',positionId:'other',details:'SYNTH/EUR',time:lot.entry_time,units:2,amount:40};
 const meta=statementLotMetadata([lot],[opening],[]).get(lot);expect(meta.statementAuthority).toBeFalsy();expect(meta.marketSymbol).toBeNull();
});

describe('source-backed legacy eToro listing evidence',()=>{
 const cases=require('../src/services/calendars/etoro-legacy-listings.json').listings.map(l=>[l.symbol,l.currency,l.marketSymbol]);
 const metadata=(symbol,currency,{broker='etoro',authority=true}={})=>{
  const lot={broker,symbol,entry_time:'2022-01-04T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:authority?'source':'different'}]};
  const opening={sourceType:'Open Position',positionId:'source',details:symbol+'/'+currency,time:lot.entry_time,units:2,amount:authority?20:40};
  return statementLotMetadata([lot],[opening],[]).get(lot);
 };
 test.each(cases)('native %s statement identity selects full broker listing',(symbol,currency,listing)=>{
  const meta=metadata(symbol,currency);expect(meta.marketSymbol).toBe(listing);expect(meta.currency).toBe(currency);
 });
 test.each(cases)('bare %s is not redirected for another broker',(symbol,currency)=>expect(metadata(symbol,currency,{broker:'other'}).marketSymbol).toBe(symbol));
 test.each(cases)('bare %s requires statement authority',(symbol,currency)=>expect(metadata(symbol,currency,{authority:false}).marketSymbol).toBeNull());
 test.each(cases)('bare %s incompatible currency does not supply a foreign listing',(symbol,currency)=>expect(metadata(symbol,currency==='USD'?'EUR':'USD').marketSymbol).toBe(symbol));
 test('existing full listing is retained',()=>expect(metadata('NESN.SW','CHF').marketSymbol).toBe('NESN.SW'));
 test('unregistered bare symbol is retained',()=>expect(metadata('UNKNOWN','CHF').marketSymbol).toBe('UNKNOWN'));
});
describe('additional statement-proven European native listings',()=>{
 const cases=[['HDD','EUR','HDD.F'],['GYC','EUR','GYC.F'],['HLAG','EUR','HLAG.F'],['SZG','EUR','SZG.F'],['EVK','EUR','EVK.F'],['KER','EUR','KER.PA'],['GLE','EUR','GLE.PA'],['IBE','EUR','IBE.MC'],['VWS','DKK','VWS.CO'],['SUBC','NOK','SUBC.OL']];
 test.each(cases)('bare %s maps only for proven native broker evidence',(symbol,currency,listing)=>{
 const lot={symbol,broker:'etoro',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'synthetic'}]};
 const opening={sourceType:'Open Position',positionId:'synthetic',details:symbol+'/'+currency,time:lot.entry_time,units:2,amount:20};
 expect(statementLotMetadata([lot],[opening],[]).get(lot)).toMatchObject({marketSymbol:listing,currency,statementAuthority:true});
 const other={...lot,broker:'other'};expect(statementLotMetadata([other],[opening],[]).get(other).marketSymbol).toBe(symbol);
 const wrong={...opening,details:symbol+'/USD'};expect(statementLotMetadata([lot],[wrong],[]).get(lot).marketSymbol).toBe(symbol);
 });
});
test('an exact registered legacy statement label requires native position proof and preserves a full trade listing',()=>{
 const lot={symbol:'GYC',broker:'etoro',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'synthetic'}]};
 const record={sourceType:'Open Position',positionId:'synthetic',details:'GYC.DR/EUR',time:lot.entry_time,units:2,amount:20};
 expect(statementLotMetadata([lot],[record],[]).get(lot)).toMatchObject({marketSymbol:'GYC.F',currency:'EUR',statementAuthority:true});
 const full={...lot,symbol:'GYC.DE'};expect(statementLotMetadata([full],[record],[]).get(full).marketSymbol).toBe('GYC.DE');
 expect(statementLotMetadata([lot],[{...record,details:'GYC.DR/USD'}],[]).get(lot).marketSymbol).toBeNull();
 const other={...lot,broker:'other'};expect(statementLotMetadata([other],[record],[]).get(other).marketSymbol).not.toBe('GYC.F');
});

describe('additional source-backed exact broker listing identities',()=>{
 const cases=[['1COV','EUR','1COV.F'],['DWNI','EUR','DWNI.F'],['MONY','GBX','MONY.L'],['FXPO','GBX','FXPO.L'],['SWDA','GBX','SWDA.L'],['LQDE','USD','LQDE.L'],['NVTKL','USD','NVTKL.L'],['OGZDL','USD','OGZDL.L'],['SBERL','USD','SBERL.L']];
 test.each(cases)('%s uses its documented listing only with matching native statement proof',(symbol,currency,listing)=>{
  const lot={symbol,broker:'etoro',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'synthetic'}]};
  const opening={sourceType:'Open Position',positionId:'synthetic',details:symbol+'/'+currency,time:lot.entry_time,units:2,amount:20};
  expect(statementLotMetadata([lot],[opening],[]).get(lot)).toMatchObject({marketSymbol:listing,currency,statementAuthority:true});
  const other={...lot,broker:'other'};expect(statementLotMetadata([other],[opening],[]).get(other).marketSymbol).not.toBe(listing);
  const full={...lot,symbol:listing};expect(statementLotMetadata([full],[{...opening,details:listing+'/'+currency}],[]).get(full).marketSymbol).toBe(listing);
 });
 test('a USD-denominated LSE fund is not inferred from account currency or arbitrary suffix',()=>{
  const lot={symbol:'LQDE',broker:'etoro',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:2,executions:[{etoro_position_id:'synthetic'}]};
  expect(statementLotMetadata([lot],[],[]).get(lot).marketSymbol).toBeNull();
  const wrong={sourceType:'Open Position',positionId:'synthetic',details:'LQDE/EUR',time:lot.entry_time,units:2,amount:20};
  expect(statementLotMetadata([lot],[wrong],[]).get(lot).marketSymbol).not.toBe('LQDE.L');
 });
});
describe('registered closed statement listing proof',()=>{
 const make=()=>({symbol:'MONY',broker:'etoro',instrument_type:'stock',entry_time:'2022-01-03T10:00:00Z',exit_time:'2022-02-04T10:00:00Z',entry_price:10,quantity:2,executions:[{type:'exit',price:12,datetime:'2022-02-04T10:00:00Z',etoro_native_price:1200,etoro_fx:.01,etoro_statement_source:true,etoro_source_type:'Stocks',etoro_position_id:'42',etoro_record_key:'statement:42',etoro_statement_symbol:'MONY'}]});
 test('verified closed native FX identifies a listing without granting split allocation authority',()=>{
  const lot=make(),before=JSON.stringify(lot),meta=statementLotMetadata([lot],[],[],{nativeFx:()=>1}).get(lot);
  expect(meta).toMatchObject({marketSymbol:'MONY.L',currency:'GBX',listingAuthority:true,statementAuthority:false});expect(JSON.stringify(lot)).toBe(before);
  expect(historicalLotQuantity(lot,'2022-01-04','2022-01-03','2022-02-04',[],[{date:'2022-02-01',ratio:2}],meta)).toBeNull();
 });
 test.each(['broker','identity','fx','price','date','source'])('rejects unproven %s in closed evidence',kind=>{
  const lot=make(),e=lot.executions[0];if(kind==='broker')lot.broker='other';if(kind==='identity')e.etoro_statement_symbol='OTHER';if(kind==='fx')e.etoro_fx=0;if(kind==='price')e.price=99;if(kind==='date')e.datetime='2021-01-01';if(kind==='source')e.etoro_statement_source=false;
  expect(statementLotMetadata([lot],[],[],{nativeFx:()=>1}).get(lot).marketSymbol).toBeNull();
 });
});
test('dated FX proof does not treat GBP major units as a GBX native rate or invent a rate',()=>{
 const lot={symbol:'MONY',broker:'etoro',entry_time:'2022-01-03',exit_time:'2022-02-04',entry_price:10,quantity:2,executions:[{type:'exit',datetime:'2022-02-04',price:12,etoro_native_price:12,etoro_fx:1,etoro_statement_source:true,etoro_source_type:'Stocks',etoro_position_id:'42',etoro_record_key:'statement:42',etoro_statement_symbol:'MONY'}]};
 expect(statementLotMetadata([lot],[],[],{nativeFx:()=>1}).get(lot).marketSymbol).toBeNull();
 const correct={...lot,executions:[{...lot.executions[0],etoro_native_price:1200,etoro_fx:.01}]};
 expect(statementLotMetadata([correct],[],[]).get(correct).marketSymbol).toBeNull();
});
test('closed listing proof can supplement consistent opening currency but never a conflicting profile',()=>{
 const lot={symbol:'MONY',broker:'etoro',entry_time:'2022-01-03T10:00:00Z',exit_time:'2022-02-04T10:00:00Z',entry_price:10,quantity:2,executions:[{type:'exit',datetime:'2022-02-04T10:00:00Z',price:12,etoro_native_price:1200,etoro_fx:.01,etoro_statement_source:true,etoro_source_type:'Stocks',etoro_position_id:'42',etoro_record_key:'statement:42',etoro_statement_symbol:'MONY'}]};
 const record={sourceType:'Open Position',positionId:'different',details:'MONY/GBX',time:lot.entry_time,amount:40,units:2};
 expect(statementLotMetadata([lot],[record],[],{nativeFx:()=>1}).get(lot)).toMatchObject({marketSymbol:'MONY.L',listingAuthority:true,statementAuthority:false});
 expect(statementLotMetadata([lot],[{...record,details:'MONY/EUR'}],[],{nativeFx:()=>1}).get(lot).marketSymbol).toBeNull();
});

describe('partial closure native-currency identity',()=>{
 const make=()=>({broker:'etoro',symbol:'SYNTH.OL',side:'long',instrument_type:'cfd',entry_time:'2024-01-02T10:00:00Z',entry_price:10,quantity:1,executions:[{type:'entry',etoro_position_id:'child',etoro_leverage:2,etoro_native_price:100}]});
 const opening={sourceType:'Open Position',positionId:'parent',details:'SYNTH/NOK',time:'2024-01-02T10:00:00Z',units:4,amount:20};
 test('recovers native currency from the original larger opening without rewriting broker fills',()=>{
  const lot=make(),before=JSON.stringify(lot),meta=statementLotMetadata([lot],[opening,opening],[]).get(lot);
  expect(meta).toMatchObject({currency:'NOK',marketSymbol:'SYNTH.OL',statementAuthority:true,unsplitCostAuthority:true});
  expect(JSON.stringify(lot)).toBe(before);
  const {cfdEquity}=require('../src/services/etoroHistoricalCfd');
  expect(cfdEquity(lot,1,110,.1)).toBeCloseTo(6);
 });
 test.each(['time','currency','cost','venue'])('rejects incompatible %s opening evidence',kind=>{
  const lot=make(),record={...opening};
  if(kind==='time')record.time='2024-01-02T10:00:01Z';
  if(kind==='currency')record.details='SYNTH/USD';
  if(kind==='cost')record.amount=40;
  if(kind==='venue'){lot.symbol='SYNTH.PA';record.details='SYNTH.DE/EUR';}
  expect(statementLotMetadata([lot],[record],[]).get(lot)).toMatchObject({currency:null,marketSymbol:null,statementAuthority:false});
 });
 test('conflicting same-time currencies remain unresolved for a bare symbol',()=>{
  const lot={...make(),symbol:'SYNTH'};
  const other={...opening,positionId:'another',details:'SYNTH/USD'};
  expect(statementLotMetadata([lot],[opening,other],[]).get(lot)).toMatchObject({currency:null,marketSymbol:null});
 });
});
