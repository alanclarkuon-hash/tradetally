const {identity,unsupportedSymbols,classifySavedTasks}=require('../../src/services/historyInstrumentIdentity');
test('native spread-bet keys cannot become stocks or imply a verified calendar',()=>{
 expect(identity({symbol:'IX.D.EXAMPLE.DAILY',instrument_type:'spread_bet'},'2026-01-01')).toMatchObject({unsupported:true,instrumentType:'spread_bet'});
 expect(identity({symbol:'SYNTHETIC',instrument_type:'future'},'2026-01-01').unsupported).toBe(true);
 expect(identity({symbol:'CONTRACT',instrument_type:'option',underlying_symbol:'ABC'},'2026-01-01')).toEqual({symbol:'ABC',instrumentType:'stock',analysisOnly:true});
});
test('commodity CFD aliases cannot silently resolve an unrelated equity ticker',()=>{
 expect(identity({symbol:'GOLD',instrument_type:'cfd'}).unsupported).toBe(true);
 expect(identity({symbol:'AAA',instrument_type:'cfd'})).toMatchObject({symbol:'AAA',instrumentType:'stock'});
 expect(identity({symbol:'AAA',instrument_type:'crypto'})).toEqual({symbol:'AAA',instrumentType:'crypto'});
});
test('saved plans retain their cursor but reclassify derivative gaps without hiding them as complete',async()=>{
 const client={query:jest.fn().mockResolvedValue({rows:[{symbol:'CONTRACT',instrument_type:'spread_bet'}]})};
 const state={tasks:[{symbol:'CONTRACT',instrumentType:'stock'},{symbol:'AAA',instrumentType:'stock'}],processed:1,complete:1,gaps:[]};
 await classifySavedTasks(client,'user',state);
 expect(state.processed).toBe(1);expect(state.complete).toBe(0);
 expect(state.tasks[0]).toMatchObject({unsupported:true,instrumentType:'spread_bet'});
 expect(state.gaps[0]).toMatchObject({unsupported:true,ranges:[]});
});
test('a typed stock using the same ticker as a broker contract is not suppressed',async()=>{
 const client={query:jest.fn().mockResolvedValue({rows:[{symbol:'AAA',instrument_type:'spread_bet'},{symbol:'AAA',instrument_type:'stock'}]})};
 expect((await unsupportedSymbols(client,'user')).size).toBe(0);
});


test('an option recorded under its underlying ticker can still warm that underlying',async()=>{
 const row={symbol:'AAA',instrument_type:'option',underlying_symbol:'AAA'};
 expect(identity(row)).toEqual({symbol:'AAA',instrumentType:'stock',analysisOnly:true});
 const client={query:jest.fn().mockResolvedValue({rows:[row]})};
 expect((await unsupportedSymbols(client,'user')).size).toBe(0);
});

test('verified eToro FX and index products remain contracts even in legacy stock imports',()=>{
 for(const symbol of ['EURUSD','GER40','NICKEL'])expect(identity({symbol,broker:'etoro',instrument_type:'stock'})).toMatchObject({symbol,unsupported:true,instrumentType:'cfd'});
 expect(identity({symbol:'EURUSD',broker:'other',instrument_type:'stock'}).unsupported).not.toBe(true);
 expect(identity({symbol:'EURUSD',broker:'etoro',instrument_type:'crypto'}).instrumentType).toBe('crypto');
});
test('saved legacy eToro stock tasks become explicit contract gaps',async()=>{
 const client={query:jest.fn().mockResolvedValue({rows:[{symbol:'EURUSD',broker:'etoro',instrument_type:'stock'}]})};
 const state={tasks:[{symbol:'EURUSD',instrumentType:'stock'}],processed:1,complete:1,gaps:[]};
 await classifySavedTasks(client,'owner',state);
 expect(state.complete).toBe(0);expect(state.tasks[0]).toMatchObject({unsupported:true,brokerProduct:'forex'});expect(state.gaps).toHaveLength(1);
});
test('a same-symbol true stock in another broker protects a shared stock requirement',async()=>{
 const client={query:jest.fn().mockResolvedValue({rows:[{symbol:'EURUSD',broker:'etoro',instrument_type:'stock'},{symbol:'EURUSD',broker:'other',instrument_type:'stock'}]})};
 expect((await unsupportedSymbols(client,'owner')).size).toBe(0);
});