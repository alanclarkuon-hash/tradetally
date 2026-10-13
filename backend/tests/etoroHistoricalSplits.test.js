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
 test.each(cases)('bare %s settlement USD does not supply a foreign listing',(symbol)=>expect(metadata(symbol,'USD').marketSymbol).toBe(symbol));
 test('existing full listing is retained',()=>expect(metadata('NESN.SW','CHF').marketSymbol).toBe('NESN.SW'));
 test('unregistered bare symbol is retained',()=>expect(metadata('UNKNOWN','CHF').marketSymbol).toBe('UNKNOWN'));
});
