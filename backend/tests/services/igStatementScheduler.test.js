jest.mock('../../src/services/igStatementSource',()=>({folderSource:jest.fn()}));
jest.mock('../../src/services/brokerSync/igStatementIngester',()=>({ingest:jest.fn()}));
jest.mock('../../src/services/brokerSync/igAutomaticReconciliation',()=>({run:jest.fn()}));
const source=require('../../src/services/igStatementSource'),ingester=require('../../src/services/brokerSync/igStatementIngester'),auto=require('../../src/services/brokerSync/igAutomaticReconciliation'),scheduler=require('../../src/services/igStatementScheduler');
beforeEach(()=>{jest.clearAllMocks();process.env.IG_INGEST_USER_ID='owner';process.env.IG_INGEST_FOLDER='/private';delete process.env.IG_INGEST_REQUIRE_RELAY;auto.run.mockResolvedValue({});});
test('retained review files do not starve new statements beyond the first twenty names',async()=>{
 const files=Array.from({length:21},(_,i)=>`${i}.pdf`),folder={list:jest.fn().mockResolvedValue(files),read:jest.fn().mockImplementation(async name=>({buffer:Buffer.from(name),filename:name})),acknowledge:jest.fn()};source.folderSource.mockReturnValue(folder);
 ingester.ingest.mockImplementation(async(_,buffer)=>buffer.toString()==='20.pdf'?{status:'imported'}:{status:'review',skipped:true});
 await scheduler.run();expect(folder.acknowledge).toHaveBeenCalledWith('20.pdf');expect(auto.run).toHaveBeenCalledWith('owner',{backup:expect.any(Function)});
});
test('a batch caps new processing and still runs automatic reconciliation',async()=>{
 const folder={list:jest.fn().mockResolvedValue(Array.from({length:25},(_,i)=>`${i}.pdf`)),read:jest.fn().mockResolvedValue({buffer:Buffer.from('PDF'),filename:'synthetic.pdf'}),acknowledge:jest.fn()};source.folderSource.mockReturnValue(folder);ingester.ingest.mockResolvedValue({status:'imported'});
 await scheduler.run();expect(ingester.ingest).toHaveBeenCalledTimes(20);expect(auto.run).toHaveBeenCalledTimes(1);
});
