jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const db=require('../../src/config/database');
const {forUser,groupChoices}=require('../../src/services/instrumentCurrencyChoices');
test('normalises minor quote units and deduplicates quote currency separately for each account',()=>{
 expect(groupChoices([{account_identifier:'one',currency:'USD'},{account_identifier:'one',currency:'EUR'},{account_identifier:'one',currency:'USD'},{account_identifier:'two',currency:'GBX'},{currency:'GBp'},{currency:null},{currency:'invalid'}])).toEqual({one:['EUR','USD'],two:['GBP'],__unsorted__:['GBP']});
});
test('restricts all private currency evidence to the authenticated user across brokers',async()=>{
 db.query.mockResolvedValue({rows:[{account_identifier:'account',currency:'EUR'}]});expect(await forUser('owner')).toEqual({account:['EUR']});
 const [sql,params]=db.query.mock.calls[0];expect(params).toEqual(['owner']);expect(sql).toContain('user_id=$1');expect(sql).not.toContain("broker='trading212'");expect(sql).toContain('symbol_categories');expect(sql).toContain('broker_portfolio_snapshots');
});
