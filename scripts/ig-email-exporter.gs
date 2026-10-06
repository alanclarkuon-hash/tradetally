// User-owned Google Apps Script. Keep configuration in Script Properties.
// Required properties: IG_FOLDER_ID, IG_FORWARDER (your Outlook email address).
// Enable Advanced Gmail service. IG_TRASH_PROCESSED=true enables acknowledged cleanup.
function collectIgStatements(options={}) {
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{
  const config=PropertiesService.getScriptProperties(),folderId=config.getProperty('IG_FOLDER_ID'),forwarder=config.getProperty('IG_FORWARDER');
  if(!folderId||!forwarder||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwarder))throw new Error('Set IG_FOLDER_ID and IG_FORWARDER in Script Properties.');
  if(options.testArchive&&(config.getProperty('IG_TEST_MODE')!=='true'||config.getProperty('IG_TRASH_PROCESSED')!=='false'))throw Error('Retained-email verification requires the isolated test configuration and disabled cleanup.');
  const root=DriveApp.getFolderById(folderId),folder=options.testArchive?igPrivateFolder(root,'Collector validation'):root;
  const cursorKey=options.testArchive?'IG_TEST_COLLECT_CURSOR':'IG_COLLECT_CURSOR',offsetKey=options.testArchive?'IG_TEST_COLLECT_OFFSET':'IG_COLLECT_OFFSET';
  const cleanup=config.getProperty('IG_TRASH_PROCESSED')==='true',toTrash=[];
  const store=igReceiptFolder(folder),deadline=Date.now()+45000;
  // Migrate bounded legacy state without losing acknowledgements, including
  // messages already in Trash. Drive receipts have no Script Properties cap.
  let migrated=0,migrationErrors=0;
  for(const [key,value] of Object.entries(config.getProperties())){
   if(!key.startsWith('done:')||migrated>=25||Date.now()>=deadline)continue;
   try{igWriteJson(store,key.slice(5)+'.json',readIgReceipt(value)||{version:0,legacyValue:value});config.deleteProperty(key);migrated++;}catch{migrationErrors++;}
  }
  const query=(options.testArchive?'in:anywhere ':'')+'from:('+forwarder+' OR no-reply.statements@email.ig.com) subject:"Your IG Statement" has:attachment filename:pdf';
  let token=config.getProperty(cursorKey)||null,offset=Number(config.getProperty(offsetKey))||0,count=0,scanned=0,errors=migrationErrors,finished=false;
  try{
  do{
   const page=Gmail.Users.Messages.list('me',{q:query,maxResults:25,...(token?{pageToken:token}:{})});
   let complete=true;
   for(const [index,stub] of (page.messages||[]).entries()){
    if(index<offset)continue;
    if(scanned>=50||Date.now()>=deadline){complete=false;offset=index;break;}
    scanned++;
    try{
    const receipt=igReadJson(store,stub.id+'.json');
    const previous=receipt?.version===0?receipt.legacyValue:receipt?JSON.stringify(receipt):config.getProperty('done:'+stub.id);
    const saved=readIgReceipt(previous);
    if(saved){if(cleanup&&igFilesProcessed(folder,saved.files))toTrash.push(stub.id);continue;}
    const message=Gmail.Users.Messages.get('me',stub.id,{format:'full'});
    const headers=message.payload.headers||[],subject=headers.find(h=>h.name.toLowerCase()==='subject')?.value||'';
    const match=subject.match(/^(?:(?:Fw|Fwd):\s*)*Your IG Statement - (\d{1,2}) (\w+) (20\d{2})$/i);
    if(!match)continue;
    const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const month=months.findIndex(m=>m.toLowerCase()===match[2].toLowerCase())+1;if(!month)continue;
    const date=match[3]+'-'+String(month).padStart(2,'0')+'-'+match[1].padStart(2,'0');
    let pdfCount=0,files=[];
    function walk(part){
     if(/\.pdf$/i.test(part.filename||'')){
      const body=part.body.attachmentId?Gmail.Users.Messages.Attachments.get('me',stub.id,part.body.attachmentId):part.body;
      const bytes=decodeIgAttachment(body.data);
      if(bytes.length>5*1024*1024||Utilities.newBlob(bytes.slice(0,16)).getDataAsString().indexOf('%PDF')<0)throw Error('Statement attachment is invalid or too large.');
      const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
      const filename=digest+' - '+part.filename.replace(/[\\/\x00-\x1f]/g,'_');
      // The persistent message receipt prevents re-export after local archival.
      // Database hashes provide cross-message and cross-filename deduplication.
      const archived=igFilesProcessed(folder,[{filename,metadataName:digest+'.json'}]);
      if(!previous&&!archived&&!folder.getFilesByName(filename).hasNext())folder.createFile(Utilities.newBlob(bytes,'application/pdf',filename));
      const metadataName=digest+'.json';
      if(!previous&&!archived&&!folder.getFilesByName(metadataName).hasNext())folder.createFile(metadataName,JSON.stringify({version:1,sha256:digest,statementDate:date}),MimeType.PLAIN_TEXT);
      files.push({filename:filename,metadataName:metadataName});
      pdfCount++;
     }
     for(const child of part.parts||[])walk(child);
    }
    walk(message.payload);
    if(pdfCount){igWriteJson(store,stub.id+'.json',{version:2,files:files,exportedAt:new Date().toISOString()});config.deleteProperty('done:'+stub.id);
     if(!previous)count++;
     if(cleanup&&igFilesProcessed(folder,files))toTrash.push(stub.id);
    }
    }catch{errors++;}
   }
   if(!complete)break;
   offset=0;
   token=page.nextPageToken;
   if(!token){finished=true;break;}
  }while(scanned<50&&Date.now()<deadline);
  }catch{errors++;token=null;offset=0;}
  if(finished||!token)config.deleteProperty(cursorKey);else config.setProperty(cursorKey,token);
  if(offset)config.setProperty(offsetKey,String(offset));else config.deleteProperty(offsetKey);
  // Mutate only after pagination: removing results mid-page can skip messages.
  let trashed=0;
  for(const id of toTrash){if(Date.now()>=deadline)break;try{Gmail.Users.Messages.trash('me',id);trashed++;}catch{errors++;}}
  igWriteJson(folder,'.collector-status.json',{version:1,lastRun:new Date().toISOString(),errors,scanned,exported:count,trashed});
  console.log('IG statement messages exported: '+count);
  console.log('Processed IG message copies moved to Trash: '+trashed);
  console.log('IG collector errors requiring review: '+errors);
 }finally{lock.releaseLock();}
}
function verifyIgCollectorOnRetainedEmails(){
 const config=PropertiesService.getScriptProperties();
 if(config.getProperty('IG_TEST_MODE')!=='true'||config.getProperty('IG_TRASH_PROCESSED')!=='false')throw Error('Retained-email verification requires the isolated test configuration and disabled cleanup.');
 collectIgStatements({testArchive:true});
}
function igReceiptFolder(folder){
 return igPrivateFolder(folder,'.collector-receipts');
}
function igPrivateFolder(folder,name){
 const matches=folder.getFoldersByName(name);
 if(!matches.hasNext())return folder.createFolder(name);
 const result=matches.next();if(matches.hasNext())throw Error('Ambiguous receipt folder.');return result;
}
function igReadJson(folder,name){
 const files=folder.getFilesByName(name);if(!files.hasNext())return null;
 const file=files.next();if(files.hasNext())throw Error('Ambiguous collector receipt.');
 return JSON.parse(file.getBlob().getDataAsString());
}
function igWriteJson(folder,name,value){
 const text=JSON.stringify(value),files=folder.getFilesByName(name);
 if(!files.hasNext()){folder.createFile(name,text,MimeType.PLAIN_TEXT);return;}
 const file=files.next();if(files.hasNext())throw Error('Ambiguous collector receipt.');file.setContent(text);
}
function readIgReceipt(value){
 try{const receipt=JSON.parse(value);return receipt.version===2&&Array.isArray(receipt.files)&&receipt.files.length?receipt:null;}catch{return null;}
}
function igFilesProcessed(folder,files){
 if(!files.length)return false;
 const archives=folder.getFoldersByName('Processed');if(!archives.hasNext())return false;
 const archive=archives.next();if(archives.hasNext())return false;
 return files.every(file=>archive.getFilesByName(file.filename).hasNext()&&archive.getFilesByName(file.metadataName).hasNext());
}
function installIgTrigger(){
 for(const trigger of ScriptApp.getProjectTriggers())if(trigger.getHandlerFunction()==='collectIgStatements')ScriptApp.deleteTrigger(trigger);
 ScriptApp.newTrigger('collectIgStatements').timeBased().everyMinutes(15).create();
}
function decodeIgAttachment(data){
 // Advanced Gmail can materialise a bytes field as Byte[]. REST responses
 // and inline parts can instead supply an unpadded base64url string.
 if(Array.isArray(data)){
  if(data.some(b=>!Number.isInteger(b)||b< -128||b>255))throw Error('Invalid attachment encoding.');
  return data.map(b=>b>127?b-256:b);
 }
 const encoded=String(data||'').replace(/\s/g,'').replace(/-/g,'+').replace(/_/g,'/');
 return Utilities.base64Decode(encoded+'='.repeat((4-encoded.length%4)%4));
}
