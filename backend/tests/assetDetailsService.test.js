jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('../src/utils/cache',()=>({get:jest.fn()}));
jest.mock('../src/services/cryptoCategoriesService',()=>({getCachedCategories:jest.fn()}));
const db=require('../src/config/database');
const {getDetails,validateSymbol,SOURCES}=require('../src/services/assetDetailsService');
beforeEach(()=>jest.resetAllMocks());
test('symbols are exact and preserve their exchange suffix',()=>{
  expect(validateSymbol(' example.l ')).toBe('EXAMPLE.L');
  expect(()=>validateSymbol("ABC';DROP TABLE trades")).toThrow('valid asset symbol');
});
test('private asset records require the signed-in owner on every page',async()=>{
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('count(*)')?[{count:26}]:[{symbol:'EXAMPLE.L',user_id:'owner',broker_connection_id:'private-link',quantity:2}]}));
  const result=await getDetails('owner','example.l',{source:'trades',offset:25});
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('symbol=$1 AND user_id=$2'),['EXAMPLE.L','owner']);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT 25 OFFSET $3'),['EXAMPLE.L','owner',25]);
  expect(result.records[0]).toEqual({symbol:'EXAMPLE.L',quantity:2});
});
test('saved crypto categories are read without provider requests',async()=>{
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('count(*)')?[{count:0}]:[]}));
  require('../src/services/cryptoCategoriesService').getCachedCategories.mockResolvedValue({categories:['Artificial Intelligence (AI)','Layer 1 (L1)'],source:'CoinGecko',asOf:'2026-01-01'});
  const result=await getDetails('owner','NEAR');
  expect(result.labels).toHaveLength(2);expect(result.kind).toBe('Crypto');expect(result.sections).toHaveLength(SOURCES.length);
});
test('record pagination cannot select arbitrary tables or invalid offsets',async()=>{
  await expect(getDetails('owner','NVDA',{source:'broker_connections'})).rejects.toThrow('Invalid saved record page');
  await expect(getDetails('owner','NVDA',{source:'trades',offset:-1})).rejects.toThrow('Invalid saved record page');
  expect(db.query).not.toHaveBeenCalled();
});
test('broker holdings preserve London ticker identity and restrict snapshots to owner',async()=>{
  db.query.mockResolvedValue({rows:[{broker_type:'trading212',account_identifier:'demo',positions:[{instrument:{ticker:'EXAMPLEl_EQ'},quantity:2},{instrument:{ticker:'EXAMPLE_US_EQ'},quantity:3}]}]});
  const result=await getDetails('owner','EXAMPLE.L',{source:'broker_portfolio_snapshots'});
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id=$1'),['owner']);
  expect(result.count).toBe(1);expect(result.records[0].position.quantity).toBe(2);
});
test('stock classification labels include stored industry',async()=>{
  db.query.mockImplementation(sql=>Promise.resolve({rows:sql.includes('count(*)')?[{count:sql.includes('symbol_categories')?1:0}]:sql.includes('SELECT * FROM symbol_categories')?[{company_name:'Example company',finnhub_industry:'Semiconductors'}]:[]}));
  const result=await getDetails('owner','EXAMPLE');
  expect(result.name).toBe('Example company');expect(result.labels).toContain('industry: Semiconductors');
});
