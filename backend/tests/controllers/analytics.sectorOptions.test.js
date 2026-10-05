jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/utils/sectorCategory',()=>({getSectorCategory:jest.fn()}));
jest.mock('../../src/utils/aiService',()=>({}));
jest.mock('../../src/utils/finnhub',()=>({}));
jest.mock('../../src/utils/symbolCategories',()=>({}));
const db=require('../../src/config/database');
const {getSectorCategory}=require('../../src/utils/sectorCategory');
const controller=require('../../src/controllers/analytics.controller');
test('sector options include user crypto themes alongside equity industries',async()=>{
 db.query.mockResolvedValueOnce({rows:[{finnhub_industry:'Software'}]})
  .mockResolvedValueOnce({rows:[{symbol:'SUI',instrument_type:'crypto'},{symbol:'SOL',instrument_type:'crypto'}]});
 getSectorCategory.mockResolvedValue({finnhub_industry:'Crypto · Layer 1 (L1)'});
 const res={json:jest.fn()},next=jest.fn();
 await controller.getAvailableSectors({user:{id:'test-user'}},res,next);
 expect(next).not.toHaveBeenCalled();expect(res.json).toHaveBeenCalledWith({sectors:['Crypto · Layer 1 (L1)','Software']});
 expect(db.query.mock.calls[1][1]).toEqual(['test-user']);
});
