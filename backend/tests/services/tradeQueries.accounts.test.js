jest.mock('../../src/config/database',()=>({query:jest.fn().mockResolvedValue({rows:[]})}));
const TradeQueries=require('../../src/services/tradeQueries');
const {parseTradeFilters,tradeFilterProfiles}=require('../../src/utils/tradeFilters');
test.each(['tradeList','tradeCount','tradeExport'])('%s retains mixed and empty account filters',profile=>{
 expect(parseTradeFilters({accounts:'one,__unsorted__'},tradeFilterProfiles[profile]).accounts).toEqual(['one','__unsorted__']);
 expect(parseTradeFilters({accounts:'__none__'},tradeFilterProfiles[profile]).accounts).toEqual(['__none__']);
});
test('trade lists and analytics bind the mixed account union without losing following filters',async()=>{
 const result=await TradeQueries._buildWhereClause('user-one',{accounts:['one','__unsorted__'],qualityGrades:['A']});
 expect(result.whereClause).toContain("AND (t.account_identifier = ANY($2::text[]) OR t.account_identifier IS NULL OR t.account_identifier = '')");
 expect(result.whereClause).toContain('t.quality_grade IN ($3)');
 expect(result.values).toEqual(['user-one',['one'],'A']);
});
test('empty account selection produces no trades while All Accounts preserves the user scope',async()=>{
 const empty=await TradeQueries._buildWhereClause('user-one',{accounts:['__none__']});
 expect(empty.whereClause).toContain('AND FALSE');expect(empty.values).toEqual(['user-one']);
 const all=await TradeQueries._buildWhereClause('user-one',{});
 expect(all.whereClause).toContain('t.user_id = $1');expect(all.whereClause).not.toContain('AND FALSE');
});

const db=require('../../src/config/database');
test.each([['NVTS',true,'LOKB'],['NV',false,'LOKB'],['NEW.L',true,'OLD.L']])('current symbol %s resolves verified broker aliases for rows and totals',async(symbol,symbolExact,original)=>{
 db.query.mockResolvedValueOnce({rows:[{account_identifier:'selected',instruments:[{ticker:'LOKB_US_EQ',shortName:'NVTS',isin:'US63942X1063'},{ticker:'OLDl_EQ',shortName:'NEW',isin:'GB0031274896'}]}]});
 const result=await TradeQueries._buildWhereClause('owner',{symbol,symbolExact,accounts:['selected'],qualityGrades:['A']});
 expect(result.whereClause).toContain("t.broker='trading212'");
 expect(result.whereClause).toContain("COALESCE(t.instrument_type,'stock')='stock'");
 expect(result.whereClause).toContain('instrument_aliases.account_identifier=t.account_identifier');
 expect(result.whereClause).toContain('instrument_aliases.symbol=UPPER(t.symbol)');
 expect(result.values[1]).toBe(symbol);expect(JSON.parse(result.values[2])).toContainEqual({account_identifier:'selected',symbol:original});
 expect(result.values.slice(3)).toEqual(['selected','A']);
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining('user_id=$1'),['owner']);
});
test('unverified aliases are excluded and unrelated symbol filters keep existing bindings',async()=>{
 db.query.mockResolvedValueOnce({rows:[{account_identifier:'selected',instruments:[{ticker:'OLD_US_EQ',shortName:'NEW',isin:null}]}]});
 const result=await TradeQueries._buildWhereClause('owner',{symbol:'NEW',symbolExact:true,accounts:['selected']});
 expect(result.whereClause).not.toContain('instrument_aliases');expect(result.values).toEqual(['owner','NEW','selected']);
});
