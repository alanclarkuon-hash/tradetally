jest.mock('../src/config/database',()=>({query:jest.fn()}));
const db=require('../src/config/database'),cache=require('../src/utils/historicalPriceCache');
beforeEach(()=>{jest.clearAllMocks();db.query.mockResolvedValue({rows:[]})});
test('reading historical SKY does not consume the legacy Skycoin namespace',async()=>{await cache.getRange('crypto:SKY','2025-01-01','2025-01-02');expect(db.query.mock.calls[0][1][0]).toBe('crypto:SKY:sky')});
test('new verified token history cannot overwrite old legacy finalized history',async()=>{await cache.insertCandles('crypto:SKY',[{time:Date.parse('2025-01-01')/1000,open:.06,high:.07,low:.05,close:.06,volume:1}],'broker:kraken',{currency:'USD'});expect(db.query.mock.calls[0][1][0]).toBe('crypto:SKY:sky');expect(db.query.mock.calls[0][0]).toContain('WHERE NOT historical_prices.is_final')});

test('even alternate ingestion paths reject legacy ambiguous sources and pre-token dates',async()=>{await cache.insertCandles('crypto:SKY',[{time:Date.parse('2023-01-01')/1000,close:.2}],'reconstruction_cache',{currency:'USD'});await cache.insertCandles('crypto:SKY',[{time:Date.parse('2023-01-01')/1000,close:.2}],'broker:kraken',{currency:'USD'});expect(db.query).not.toHaveBeenCalled()});
