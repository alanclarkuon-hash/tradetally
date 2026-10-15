const handler = require('../../src/middleware/errorHandler');
test.each(['/api/broker-sync/connections/test/sync','/api/trades/import','/api/v1/trades/import','/api/trades/import/validate'])('import error middleware omits private stack for %s', path => {
 const spy=jest.spyOn(console,'error').mockImplementation(()=>{});
 try {
  const error=new Error('PRIVATE-SOURCE-ROW-123.45');
  const req={originalUrl:path,headers:{},method:'POST'};
  const res={req,status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis()};
  handler(error,req,res,jest.fn());
  expect(spy).toHaveBeenCalled();
  expect(JSON.stringify(spy.mock.calls)).not.toContain('PRIVATE-SOURCE-ROW');
  expect(res.status).toHaveBeenCalled();
 }finally{spy.mockRestore();}
});
