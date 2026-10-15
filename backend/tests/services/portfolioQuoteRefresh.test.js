jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/utils/displayCurrency',()=>({getRatesToDisplay:jest.fn()}));
jest.mock('../../src/services/priceMonitoringService',()=>({getStatus:()=>({lastRotation:{total:10,durationSeconds:120}})}));
jest.mock('../../src/services/brokerPositionValuations',()=>({read:jest.fn().mockResolvedValue({positions:[]})}));
const db=require('../../src/config/database'),fx=require('../../src/utils/displayCurrency'),service=require('../../src/services/portfolioQuoteRefresh');
beforeEach(()=>{jest.clearAllMocks();db.query.mockResolvedValue({rows:[{symbol:'crypto:BTC',current_price:10}]});fx.getRatesToDisplay.mockResolvedValue({USD:0.8});});
test('cache-only reads keep crypto identity, bound inputs and return display conversion and aggregate monitoring status',async()=>{
 const result=await service.read({symbols:'crypto:BTC,ABC,ABC',currency:'GBP'});
 expect(db.query.mock.calls[0][1]).toEqual([['crypto:BTC','ABC']]);expect(db.query).toHaveBeenCalledTimes(1);
 expect(result).toMatchObject({currency:'GBP',usdRate:0.8,monitoring:{lastRotation:{durationSeconds:120}}});
 await expect(service.read({symbols:Array.from({length:251},(_,i)=>'A'+i).join(',')})).rejects.toMatchObject({status:400});
 await expect(service.read({currency:'invalid'})).rejects.toMatchObject({status:400});
});

test('valuation read is scoped to the authenticated user and selected accounts',async()=>{
 const valuations=require('../../src/services/brokerPositionValuations');await service.read({accounts:'one,two',symbols:''},'owner');
 expect(valuations.read).toHaveBeenCalledWith('owner',['one','two']);
});
