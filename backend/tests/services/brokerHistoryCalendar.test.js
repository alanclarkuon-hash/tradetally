jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/services/brokerInstrumentSymbols',()=>({applyTradeHistoricalSymbols:jest.fn().mockResolvedValue(),cataloguesForUser:jest.fn()}));
jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn()}));
jest.mock('../../src/services/brokerHistoryProviders',()=>({etoroArchivedEquities:jest.fn()}));
const db=require('../../src/config/database'),BC=require('../../src/models/BrokerConnection'),provider=require('../../src/services/brokerHistoryProviders'),calendar=require('../../src/services/exchangeCalendar');
beforeEach(()=>jest.resetAllMocks());
test('retired calendar uses exact typed venue only for the owner and broker',async()=>{
 db.query.mockResolvedValueOnce({rows:[{broker:'etoro',instrument_type:'stock'}]}).mockResolvedValueOnce({rows:[{id:'synthetic'}]});
 BC.findById.mockResolvedValue({});provider.etoroArchivedEquities.mockResolvedValue([{symbolFull:'RETIRED',instrumentTypeId:5,exchange:'Nasdaq'}]);
 expect(await calendar.brokerCalendar('owner','RETIRED')).toBe('US');expect(db.query.mock.calls[0][1]).toEqual(['owner','RETIRED']);
 expect(await calendar.resolve('RETIRED')).toBeNull();
});
test('other brokers cannot inherit a same-named retired venue',async()=>{
 db.query.mockResolvedValue({rows:[{broker:'etoro',instrument_type:'stock'},{broker:'other',instrument_type:'stock'}]});
 expect(await calendar.brokerCalendar('other-owner','COLLISION')).toBeNull();expect(provider.etoroArchivedEquities).not.toHaveBeenCalled();
});
test.each([{metadata:[]},{metadata:[{symbolFull:'UNKNOWN',instrumentTypeId:5,exchange:'FX'}]},{metadata:[{symbolFull:'UNKNOWN',instrumentTypeId:5,exchange:'Nasdaq'},{symbolFull:'UNKNOWN',instrumentTypeId:5,exchange:'NYSE'}]}])('unverified or ambiguous archived venue does not supply a calendar: %p',async ({metadata})=>{
 db.query.mockResolvedValueOnce({rows:[{broker:'etoro'}]}).mockResolvedValueOnce({rows:[{id:'synthetic'}]});BC.findById.mockResolvedValue({});provider.etoroArchivedEquities.mockResolvedValue(metadata);
 expect(await calendar.brokerCalendar('owner-'+JSON.stringify(metadata),'UNKNOWN')).toBeNull();
});
test('a different historical broker mapping removes a raw-symbol collision',async()=>{
 db.query.mockResolvedValueOnce({rows:[{symbol:'DISTINCT',broker:'etoro'},{symbol:'DISTINCT',broker:'other'}]}).mockResolvedValueOnce({rows:[{id:'synthetic'}]});
 require('../../src/services/brokerInstrumentSymbols').applyTradeHistoricalSymbols.mockImplementation(async(_db,_owner,rows)=>{rows[1].history_market_symbol='DISTINCT.L'});
 BC.findById.mockResolvedValue({});provider.etoroArchivedEquities.mockResolvedValue([{symbolFull:'DISTINCT',instrumentTypeId:5,exchange:'Nasdaq'}]);
 expect(await calendar.brokerCalendar('owner','DISTINCT')).toBe('US');
});

test('independent native US fill evidence permits the same cross-broker calendar',async()=>{
 const time='2023-02-03T12:00:00Z',entry={type:'entry',order_id:'fill-1',datetime:time,quantity:.4};
 const other={symbol:'PROVEN',broker:'trading212',instrument_type:'stock',account_identifier:'synthetic',executions:[entry]};
 db.query.mockResolvedValueOnce({rows:[{symbol:'PROVEN',broker:'etoro'},other]})
 .mockResolvedValueOnce({rows:[{account_identifier:'synthetic',records:[{reference:'fill-1',time,side:'BUY',quantity:1,symbol:'PROVEN_US_EQ'},{reference:'fill-1',time,side:'BUY',quantity:1,symbol:'PROVEN_US_EQ'}]}]})
 .mockResolvedValueOnce({rows:[{id:'synthetic'}]});
 require('../../src/services/brokerInstrumentSymbols').cataloguesForUser.mockResolvedValue([{account_identifier:'synthetic',instruments:[{ticker:'PROVEN_US_EQ',shortName:'PROVEN',isin:'US1234567890',currencyCode:'USD'}]}]);
 BC.findById.mockResolvedValue({});provider.etoroArchivedEquities.mockResolvedValue([{symbolFull:'PROVEN',instrumentTypeId:5,exchange:'Nasdaq'}]);
 expect(await calendar.brokerCalendar('proven-owner','PROVEN')).toBe('US');
});
test.each(['account','time','quantity','symbol','duplicate','currency','missing'])('unverified %s native fill cannot resolve a cross-broker calendar',async mode=>{
 const time='2023-02-03T12:00:00Z',entry={type:'entry',order_id:'fill-1',datetime:time,quantity:.4};
 const record={reference:'fill-1',time,side:'BUY',quantity:1,symbol:'PROVEN_US_EQ'},instrument={ticker:'PROVEN_US_EQ',shortName:'PROVEN',isin:'US1234567890',currencyCode:'USD'};
 const account=mode==='account'?'another':'synthetic';
 if(mode==='time')record.time='2023-02-04T12:00:00Z';if(mode==='quantity')record.quantity=.1;if(mode==='symbol')instrument.shortName='OTHER';if(mode==='currency')instrument.currencyCode='GBP';
 db.query.mockResolvedValue({rows:[{account_identifier:account,records:mode==='missing'?[]:mode==='duplicate'?[record,{...record,symbol:'OTHER_US_EQ'}]:[record]}]});
 require('../../src/services/brokerInstrumentSymbols').cataloguesForUser.mockResolvedValue([{account_identifier:'synthetic',instruments:[instrument]}]);
 expect(await calendar.trading212CalendarEvidence('owner','PROVEN',[{broker:'trading212',account_identifier:'synthetic',executions:[entry]}])).toBeNull();
});

