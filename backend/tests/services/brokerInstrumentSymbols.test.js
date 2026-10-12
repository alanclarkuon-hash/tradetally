jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const db=require('../../src/config/database');
const {catalogueMapping,saveCatalogue,catalogueForAccount,applyTradeMarketSymbols,historicalSymbol}=require('../../src/services/brokerInstrumentSymbols');
const item={ticker:'LOKB_US_EQ',shortName:'NVTS',isin:'US63942X1063',currencyCode:'USD',name:'Navitas'};
beforeEach(()=>jest.clearAllMocks());
test('durable catalogue stores only instrument attributes, keyed to owner and account',async()=>{db.query.mockResolvedValue({rows:[]});await saveCatalogue({userId:'owner',externalAccountId:'1234'},[{...item,apiSecret:'synthetic-secret',positions:[1]}]);const [sql,params]=db.query.mock.calls[0];expect(sql).toContain('ON CONFLICT');expect(params.slice(0,2)).toEqual(['owner','****1234']);expect(JSON.parse(params[2])).toEqual([item]);expect(params[2]).not.toContain('apiSecret')});
test('metadata reads remain owner/account scoped and never invoke broker APIs',async()=>{db.query.mockResolvedValue({rows:[{instruments:[item]}]});expect(await catalogueForAccount(db,'owner','selected')).toEqual([item]);expect(db.query).toHaveBeenCalledWith(expect.stringContaining('account_identifier=$2'),['owner','selected'])});
test('historical mapping works after position is closed and retains dated corporate-action boundary',()=>{const map=catalogueMapping([item,{ticker:'SRNG_US_EQ',shortName:'DNA',isin:'US37611X1000'}]);expect(historicalSymbol(map,'LOKB_US_EQ','2026-04-15')).toBe('NVTS');expect(historicalSymbol(map,'SRNG_US_EQ','2021-08-01')).toBe('SRNG');expect(historicalSymbol(map,'SRNG_US_EQ','2021-10-01')).toBe('DNA')});
test('unverified or ambiguous ticker aliases never map old history to another security',()=>{expect(catalogueMapping([{...item,isin:null}]).has('LOKB')).toBe(false);expect(catalogueMapping([item,{...item,isin:'US0378331005',shortName:'OTHER'}]).has('LOKB')).toBe(false)});
test('quote identity uses selected-account catalogue without changing stored financial fields',async()=>{db.query.mockResolvedValue({rows:[{account_identifier:'selected',instruments:[item]}]});const t={broker:'trading212',account_identifier:'selected',symbol:'LOKB',instrument_type:'stock',original_currency:'GBP',entry_price:10,pnl:12,executions:[{id:'broker'}],current_price:999};const foreign={...t,account_identifier:'other'};await applyTradeMarketSymbols(db,'owner',[t,foreign]);expect(t).toMatchObject({symbol:'LOKB',market_symbol:'NVTS',market_currency:'USD',instrument_currency:'USD',entry_price:10,pnl:12,original_currency:'GBP',current_price:null,executions:[{id:'broker'}]});expect(foreign.market_symbol).toBe('LOKB')});
test('London listings preserve price unit and exchange suffix; options and crypto are not renamed',async()=>{db.query.mockResolvedValue({rows:[{account_identifier:'selected',instruments:[{ticker:'OLDl_EQ',shortName:'NEW',isin:'GB0031274896',currencyCode:'GBX'}]}]});const stock={broker:'trading212',account_identifier:'selected',symbol:'OLD.L',instrument_type:'stock',original_currency:'GBP'};const option={...stock,instrument_type:'option'},crypto={...stock,instrument_type:'crypto'};await applyTradeMarketSymbols(db,'owner',[stock,option,crypto]);expect(stock).toMatchObject({symbol:'OLD.L',market_symbol:'NEW.L',market_currency:'GBX',instrument_currency:'GBP',original_currency:'GBP'});expect(option.market_symbol).toBeUndefined();expect(crypto.market_symbol).toBeUndefined()});


test('backfill mapping uses dated verified account catalogues without changing broker trade keys',async()=>{
 db.query.mockResolvedValue({rows:[{account_identifier:'selected',instruments:[item,{ticker:'SRNG_US_EQ',shortName:'DNA',isin:'US37611X1000'}]}]});
 const rows=[{broker:'trading212',account_identifier:'selected',symbol:'LOKB',instrument_type:'stock',trade_date:'2026-01-01'},
  {broker:'trading212',account_identifier:'selected',symbol:'SRNG',instrument_type:'stock',trade_date:'2021-08-01'},
  {broker:'trading212',account_identifier:'other',symbol:'LOKB',instrument_type:'stock',trade_date:'2026-01-01'}];
 await require('../../src/services/brokerInstrumentSymbols').applyTradeHistoricalSymbols(db,'owner',rows);
 expect(rows.map(t=>t.history_market_symbol)).toEqual(['NVTS','SRNG','LOKB']);
 expect(rows.map(t=>t.symbol)).toEqual(['LOKB','SRNG','LOKB']);
});
