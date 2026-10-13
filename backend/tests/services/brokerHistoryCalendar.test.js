jest.mock('../../src/config/database',()=>({query:jest.fn()}));
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