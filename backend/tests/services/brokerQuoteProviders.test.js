jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn()}));
jest.mock('../../src/services/brokerSync/etoroService',()=>({get:jest.fn(),field:(o,k)=>{const key=Object.keys(o||{}).find(n=>n.toLowerCase()===k.toLowerCase());return o?.[key];}}));
jest.mock('../../src/services/brokerMarketData',()=>({read:jest.fn(),directory:async(_key,fn)=>fn()}));
jest.mock('../../src/services/brokerSync/trading212Service',()=>({fetchPositions:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({getForexRate:jest.fn()}));
const db=require('../../src/config/database'),BC=require('../../src/models/BrokerConnection');
const etoro=require('../../src/services/brokerSync/etoroService'),market=require('../../src/services/brokerMarketData');
const providers=require('../../src/services/brokerQuoteProviders');
beforeEach(()=>jest.resetAllMocks());
test('eToro validates type and ID and uses broker USD conversion with original timestamp',async()=>{
 db.query.mockResolvedValue({rows:[{payload:{instruments:[{symbolFull:'TEST',instrumentId:1,instrumentTypeID:2}],instrumentTypes:[{instrumentTypeID:2,instrumentTypeDescription:'Stocks'}]}}]});
 const date=new Date().toISOString();etoro.get.mockResolvedValue({rates:[{instrumentID:1,bid:10,conversionRateBid:1.5,date}]});
 expect(await providers.etoroQuote({symbol:'TEST',instrumentType:'stock',connection:{id:'one'}})).toMatchObject({c:15,currency:'USD',asOf:date});
 etoro.get.mockClear();expect(await providers.etoroQuote({symbol:'TEST',instrumentType:'crypto',connection:{id:'one'}})).toBeNull();expect(etoro.get).not.toHaveBeenCalled();
});
test('Kraken requires exact USD pair and handles Bitcoin alias',async()=>{
 market.read.mockResolvedValueOnce({result:{XXBTZUSD:{wsname:'XBT/USD'}}}).mockResolvedValueOnce({result:{XXBTZUSD:{c:['123']}}});
 expect(await providers.krakenQuote({symbol:'BTC',instrumentType:'crypto'})).toMatchObject({c:123,source:'broker:kraken'});
});
test('Trading 212 reuses one positions request for multiple symbols and verifies the saved listing identity',async()=>{
 const service=require('../../src/services/brokerSync/trading212Service');
 service.fetchPositions.mockResolvedValue([{instrument:{ticker:'OLD_US_EQ',isin:'same',currency:'USD'},currentPrice:3},
 {instrument:{ticker:'OTHER_US_EQ',currency:'USD'},currentPrice:4}]);
 db.query.mockResolvedValue({rows:[{positions:[{instrument:{ticker:'OLD_US_EQ',shortName:'NEW',isin:'same'}}]}]});
 expect(await providers.trading212Quote({symbol:'NEW',instrumentType:'stock',connection:{id:'cached-positions'}})).toMatchObject({c:3,source:'broker:trading212'});
 expect(await providers.trading212Quote({symbol:'OTHER',instrumentType:'stock',connection:{id:'cached-positions'}})).toMatchObject({c:4});
 expect(service.fetchPositions).toHaveBeenCalledTimes(1);
});
test('OKX USDT pairs need a contemporaneous USD index conversion',async()=>{
 const ts=String(Date.now());market.read.mockResolvedValueOnce({code:'0',data:[{baseCcy:'COIN',quoteCcy:'USDT',instId:'COIN-USDT',state:'live'}]})
 .mockResolvedValueOnce({code:'0',data:[{instId:'COIN-USDT',instType:'SPOT',last:'10',ts}]})
 .mockResolvedValueOnce({code:'0',data:[{instId:'USDT-USD',idxPx:'0.99',ts}]});
 expect(await providers.okxQuote({symbol:'COIN',instrumentType:'crypto',connection:{}})).toMatchObject({c:9.9,currency:'USD'});
});
test('new registered broker capability is tried without orchestrator edits; errors stay sanitized',async()=>{
 db.query.mockResolvedValue({rows:[{id:'a',broker_type:'test-broker'}]});BC.findById.mockResolvedValue({});
 providers.adapters.set('test-broker',jest.fn().mockResolvedValue({c:1,currency:'USD',source:'broker:test'}));
 expect(await providers.fetch('UNIQUE','stock')).toMatchObject({source:'broker:test'});
 providers.adapters.set('test-broker',()=>{throw Error('private key');});
 expect(await providers.fetch('OTHER','stock')).toBeNull();providers.adapters.delete('test-broker');
});
