const {accountPredicate}=require('../../src/utils/accountFilter');
test('named accounts and unlinked trades share one parenthesised union',()=>{
  const params=['user-id'];
  const sql=accountPredicate(['one','two','__unsorted__'],params);
  expect(sql).toBe("(t.account_identifier = ANY($2::text[]) OR t.account_identifier IS NULL OR t.account_identifier = '')");
  expect(params).toEqual(['user-id',['one','two']]);
});
test('empty selection cannot become unfiltered and never binds sentinel as an account',()=>{
  const params=[];
  expect(accountPredicate(['__none__'],params)).toBe('FALSE');
  expect(accountPredicate([],params)).toBe('TRUE');
  expect(params).toEqual([]);
});
test('account values are bound and cannot escape the filter or change parameter numbering',()=>{
  const params=['user-id','2026-01-01'];
  const malicious="one') OR TRUE --";
  const sql=accountPredicate([malicious,'__unsorted__'],params,'account_trade.account_identifier',3);
  expect(sql).not.toContain(malicious);expect(sql).toContain('$3::text[]');
  expect(params).toEqual(['user-id','2026-01-01',[malicious]]);
});
