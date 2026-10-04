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
