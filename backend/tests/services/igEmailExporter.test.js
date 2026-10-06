const fs=require('fs'),path=require('path'),vm=require('vm');
const context={Utilities:{base64Decode:value=>[...Buffer.from(value,'base64')].map(n=>n>127?n-256:n)}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../scripts/ig-email-exporter.gs'),'utf8'),context);
test('accepts Advanced Gmail already decoded Byte arrays',()=>{expect([...context.decodeIgAttachment([37,80,68,70,-1])]).toEqual([37,80,68,70,-1]);});
test('decodes unpadded REST base64url attachments',()=>{const bytes=Buffer.from('%PDF\xff','latin1');expect([...context.decodeIgAttachment(bytes.toString('base64url'))]).toEqual([...bytes].map(n=>n>127?n-256:n));});
test('invalid byte arrays cannot become statement files',()=>{expect(()=>context.decodeIgAttachment([37,999])).toThrow('Invalid');});

function iterator(items){let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};}
function collectorFixture({processed=[],receipt,cleanup=true,messages=['first']}={}){
 const props=new Map([['IG_FOLDER_ID','folder'],['IG_FORWARDER','sender@example.test'],['IG_TRASH_PROCESSED',String(cleanup)],...(receipt?[['done:first',receipt]]:[])]);
 const archive={getFilesByName:name=>iterator(processed.includes(name)?[{}]:[])};
 const folder={getFoldersByName:()=>iterator([archive]),getFilesByName:()=>iterator([]),createFile:jest.fn()};
 const trash=jest.fn(),get=jest.fn(()=>({payload:{headers:[{name:'Subject',value:'Fwd: Your IG Statement - 2 October 2026'}],filename:'2 October 2026 Share dealing Statement.pdf',body:{data:[37,80,68,70]}}}));
 const env={LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)})},DriveApp:{getFolderById:()=>folder},Gmail:{Users:{Messages:{list:jest.fn(()=>({messages:messages.map(id=>({id}))})),get,trash}}},Utilities:{...context.Utilities,newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString()}),computeDigest:()=>Array(32).fill(1),DigestAlgorithm:{SHA_256:'sha'}},MimeType:{PLAIN_TEXT:'text/plain'},console:{log:()=>{}}};
 vm.createContext(env);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../scripts/ig-email-exporter.gs'),'utf8'),env);
 return {env,props,trash,get,folder};
}
const pair={filename:'01'.repeat(32)+' - 2 October 2026 Share dealing Statement.pdf',metadataName:'01'.repeat(32)+'.json'};
test('acknowledged PDFs and metadata allow only the matching message to move to Trash',()=>{
 const f=collectorFixture({receipt:JSON.stringify({version:2,files:[pair]}),processed:Object.values(pair)});f.env.collectIgStatements();expect(f.trash).toHaveBeenCalledWith('me','first');expect(f.get).not.toHaveBeenCalled();
});
test.each([[[]],[[pair.filename]],[[pair.metadataName]]])('an incomplete archive never deletes an email (%j)',processed=>{
 const f=collectorFixture({receipt:JSON.stringify({version:2,files:[pair]}),processed});f.env.collectIgStatements();expect(f.trash).not.toHaveBeenCalled();
});
test('all PDFs in a message must be acknowledged',()=>{
 const f=collectorFixture({receipt:JSON.stringify({version:2,files:[pair,{filename:'other.pdf',metadataName:'other.json'}]}),processed:Object.values(pair)});f.env.collectIgStatements();expect(f.trash).not.toHaveBeenCalled();
});
test('legacy timestamp receipts recover archive identities without re-exporting files',()=>{
 const f=collectorFixture({receipt:'2026-10-06T18:00:00Z',processed:Object.values(pair)});f.env.collectIgStatements();expect(f.folder.createFile).not.toHaveBeenCalled();expect(f.trash).toHaveBeenCalledWith('me','first');expect(JSON.parse(f.props.get('done:first')).version).toBe(2);
});
test('new exports are retained in Gmail until acknowledged',()=>{
 const f=collectorFixture();f.env.collectIgStatements();expect(f.folder.createFile).toHaveBeenCalledTimes(2);expect(f.trash).not.toHaveBeenCalled();
});
test('cleanup can be disabled without changing the import receipt',()=>{
 const f=collectorFixture({cleanup:false,receipt:JSON.stringify({version:2,files:[pair]}),processed:Object.values(pair)});f.env.collectIgStatements();expect(f.trash).not.toHaveBeenCalled();
});

