jest.mock('../src/config/database',()=>({query:jest.fn()}));
jest.mock('axios',()=>({get:jest.fn()}));
const db=require('../src/config/database');
const axios=require('axios');
const {classify,exchangesFor,getClassifications}=require('../src/services/assetClassificationService');
const row={symbol:'MSFT',sector:'Information Technology',industry_group:'Software & Services',industry:'Software',exchange:'NMS'};
beforeEach(()=>jest.clearAllMocks());
test('maps the three source levels to codes using the same hierarchy',()=>{
  expect(classify('MSFT',[row])).toMatchObject({sector_code:'45',industry_group_code:'4510',industry_code:'451030',status:'matched'});
  expect(classify('NVDA',[{...row,symbol:'NVDA',industry_group:'Semiconductors & Semiconductor Equipment',industry:'Semiconductors & Semiconductor Equipment'}])).toMatchObject({industry_code:'453010'});
});
test('does not guess when source labels conflict or have changed',()=>{
  expect(classify('MSFT',[row,{...row,industry:'Banks'}]).status).toBe('conflict');
  expect(classify('MSFT',[{...row,industry:'Unrecognised industry'}])).toMatchObject({industry_code:null,status:'unmapped'});
});
test('exchange suffixes are exact and cannot adopt a neighbouring listing',()=>{
  expect(exchangesFor('ABC.L')).toEqual(['LSE']);expect(exchangesFor('ABC.UNKNOWN')).toEqual([]);
  expect(classify('MSFT.L',[row]).status).toBe('not_found');
});
test('fresh saved classification reads make no upstream request or provider write',async()=>{
  db.query.mockResolvedValue({rows:[{symbol:'MSFT',fetched_at:new Date().toISOString(),...classify('MSFT',[row])}]});
  const result=await getClassifications(['MSFT']);
  expect(result.get('MSFT').industry_code).toBe('451030');expect(axios.get).not.toHaveBeenCalled();expect(db.query).toHaveBeenCalledTimes(1);
});
test('failed download preserves saved classification without replacing it with a miss',async()=>{
  db.query.mockResolvedValue({rows:[{symbol:'MSFT',fetched_at:'2020-01-01',...classify('MSFT',[row])}]});axios.get.mockRejectedValue(Error('unavailable'));
  const result=await getClassifications(['MSFT']);expect(result.get('MSFT').industry_code).toBe('451030');expect(db.query).toHaveBeenCalledTimes(1);
});
test('enrichment writes only the separate reference table',async()=>{
  db.query.mockImplementation((sql,params)=>Promise.resolve({rows:sql.startsWith('INSERT')?[{symbol:params[0],sector_code:params[2],industry_code:params[6],status:params[9]}]:[]}));
  axios.get.mockResolvedValue({data:'symbol,sector,industry_group,industry,exchange\nDEMO.L,Information Technology,Software & Services,Software,LSE\n'});
  const result=await getClassifications(['DEMO.L']);
  expect(result.get('DEMO.L').industry_code).toBe('451030');
  expect(db.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO asset_reference_classifications'))).toBe(true);
  expect(db.query.mock.calls.some(([sql])=>sql.includes('symbol_categories'))).toBe(false);
});
