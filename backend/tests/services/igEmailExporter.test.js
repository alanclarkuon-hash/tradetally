const fs=require('fs'),path=require('path'),vm=require('vm');
const context={Utilities:{base64Decode:value=>[...Buffer.from(value,'base64')].map(n=>n>127?n-256:n)}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../scripts/ig-email-exporter.gs'),'utf8'),context);
test('accepts Advanced Gmail already decoded Byte arrays',()=>{expect([...context.decodeIgAttachment([37,80,68,70,-1])]).toEqual([37,80,68,70,-1]);});
test('decodes unpadded REST base64url attachments',()=>{const bytes=Buffer.from('%PDF\xff','latin1');expect([...context.decodeIgAttachment(bytes.toString('base64url'))]).toEqual([...bytes].map(n=>n>127?n-256:n));});
test('invalid byte arrays cannot become statement files',()=>{expect(()=>context.decodeIgAttachment([37,999])).toThrow('Invalid');});

function iterator(items){let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};}
function collectorFixture({processed=[],receipt,cleanup=true,messages=['first']}={}){
 const props=new Map([['IG_FOLDER_ID','folder'],['IG_FORWARDER','sender@example.test'],['IG_TRASH_PROCESSED',String(cleanup)],...(receipt?[['done:first',receipt]]:[])]);
 function driveFolder(){const files=new Map(),folders=new Map();return {files,folders,getFoldersByName:name=>iterator(folders.has(name)?[folders.get(name)]:[]),createFolder:name=>{const value=driveFolder();folders.set(name,value);return value;},getFilesByName:name=>iterator(files.has(name)?[files.get(name)]:[]),createFile:jest.fn((name,content)=>{if(typeof name==='object'){content=Buffer.from(name.bytes).toString();name=name.name;}const file={content,getBlob:()=>({getDataAsString:()=>file.content}),setContent:value=>{file.content=value;}};files.set(name,file);return file;})};}
 const folder=driveFolder(),archive=folder.createFolder('Processed');for(const name of processed)archive.files.set(name,{});
 const trash=jest.fn(),get=jest.fn(()=>({payload:{headers:[{name:'Subject',value:'Fwd: Your IG Statement - 2 October 2026'}],filename:'2 October 2026 Share dealing Statement.pdf',body:{data:[37,80,68,70]}}}));
 const env={LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value),deleteProperty:key=>props.delete(key),getProperties:()=>Object.fromEntries(props)})},DriveApp:{getFolderById:()=>folder},Gmail:{Users:{Messages:{list:jest.fn(()=>({messages:messages.map(id=>({id}))})),get,trash}}},Utilities:{...context.Utilities,newBlob:(bytes,type,name)=>({bytes,name,getDataAsString:()=>Buffer.from(bytes).toString()}),computeDigest:()=>Array(32).fill(1),DigestAlgorithm:{SHA_256:'sha'}},MimeType:{PLAIN_TEXT:'text/plain'},console:{log:()=>{}}};
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
 const f=collectorFixture({receipt:'2026-10-06T18:00:00Z',processed:Object.values(pair)});f.env.collectIgStatements();expect(f.folder.files.has(pair.filename)).toBe(false);expect(f.trash).toHaveBeenCalledWith('me','first');expect(f.props.has('done:first')).toBe(false);expect(JSON.parse(f.folder.folders.get('.collector-receipts').files.get('first.json').content).version).toBe(2);
});
test('new exports are retained in Gmail until acknowledged',()=>{
 const f=collectorFixture();f.env.collectIgStatements();expect(f.folder.files.has(pair.filename)).toBe(true);expect(f.folder.files.has(pair.metadataName)).toBe(true);expect(f.trash).not.toHaveBeenCalled();
});

test('a malformed attachment cannot block another valid message or trash the failed email',()=>{
 const f=collectorFixture({messages:['bad','good']});
 f.get.mockImplementation((_,id)=>({payload:{headers:[{name:'Subject',value:'Your IG Statement - 2 October 2026'}],filename:'2 October 2026 Share dealing Statement.pdf',body:{data:id==='bad'?[1,2,3]:[37,80,68,70]}}}));
 f.env.collectIgStatements();
 expect(f.folder.folders.get('.collector-receipts').files.has('good.json')).toBe(true);
 expect(f.folder.folders.get('.collector-receipts').files.has('bad.json')).toBe(false);
 expect(JSON.parse(f.folder.files.get('.collector-status.json').content).errors).toBe(1);
 expect(f.trash).not.toHaveBeenCalled();
});

test('legacy receipts migrate in bounded batches to Drive instead of growing Script Properties',()=>{
 const f=collectorFixture({messages:[]});for(let i=0;i<100;i++)f.props.set('done:old'+i,JSON.stringify({version:2,files:[pair]}));
 f.env.collectIgStatements();expect([...f.props.keys()].filter(k=>k.startsWith('done:'))).toHaveLength(75);
 expect(f.folder.folders.get('.collector-receipts').files.size).toBe(25);
});

test('collection resumes bounded pages without letting reviewed receipts consume the whole scan',()=>{
 const f=collectorFixture({messages:[]});
 f.env.Gmail.Users.Messages.list.mockImplementation((_,options)=>({messages:Array.from({length:25},(_,i)=>({id:(options.pageToken||'first')+i})),nextPageToken:options.pageToken==='third'?null:options.pageToken==='second'?'third':'second'}));
 f.env.collectIgStatements();expect(f.get).toHaveBeenCalledTimes(50);expect(f.props.get('IG_COLLECT_CURSOR')).toBe('third');
 f.env.collectIgStatements();expect(f.get).toHaveBeenCalledTimes(75);expect(f.props.has('IG_COLLECT_CURSOR')).toBe(false);
});
test('cleanup can be disabled without changing the import receipt',()=>{
 const f=collectorFixture({cleanup:false,receipt:JSON.stringify({version:2,files:[pair]}),processed:Object.values(pair)});f.env.collectIgStatements();expect(f.trash).not.toHaveBeenCalled();
});

