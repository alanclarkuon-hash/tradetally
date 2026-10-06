// User-owned Google Apps Script. Keep configuration in Script Properties.
// Required properties: IG_FOLDER_ID, IG_FORWARDER (your Outlook email address).
// Enable Advanced Gmail service. IG_TRASH_PROCESSED=true enables acknowledged cleanup.
function collectIgStatements() {
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{
  const config=PropertiesService.getScriptProperties(),folderId=config.getProperty('IG_FOLDER_ID'),forwarder=config.getProperty('IG_FORWARDER');
  if(!folderId||!forwarder||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwarder))throw new Error('Set IG_FOLDER_ID and IG_FORWARDER in Script Properties.');
  const folder=DriveApp.getFolderById(folderId);
  const cleanup=config.getProperty('IG_TRASH_PROCESSED')==='true',toTrash=[];
  const query='from:('+forwarder+' OR no-reply.statements@email.ig.com) subject:"Your IG Statement" has:attachment filename:pdf';
  let token=null,count=0;
  do{
   const page=Gmail.Users.Messages.list('me',{q:query,maxResults:25,...(token?{pageToken:token}:{})});
   for(const stub of page.messages||[]){
    const receipt='done:'+stub.id,previous=config.getProperty(receipt);
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
      if(!previous&&!folder.getFilesByName(filename).hasNext())folder.createFile(Utilities.newBlob(bytes,'application/pdf',filename));
      const metadataName=digest+'.json';
      if(!previous&&!folder.getFilesByName(metadataName).hasNext())folder.createFile(metadataName,JSON.stringify({version:1,sha256:digest,statementDate:date}),MimeType.PLAIN_TEXT);
      files.push({filename:filename,metadataName:metadataName});
      pdfCount++;
     }
     for(const child of part.parts||[])walk(child);
    }
    walk(message.payload);
    if(pdfCount){config.setProperty(receipt,JSON.stringify({version:2,files:files,exportedAt:previous||new Date().toISOString()}));
     if(!previous)count++;
     if(cleanup&&igFilesProcessed(folder,files))toTrash.push(stub.id);
    }
   }
   token=page.nextPageToken;
  }while(token&&count<50);
  // Mutate only after pagination: removing results mid-page can skip messages.
  for(const id of toTrash)Gmail.Users.Messages.trash('me',id);
  console.log('IG statement messages exported: '+count);
  console.log('Processed IG message copies moved to Trash: '+toTrash.length);
 }finally{lock.releaseLock();}
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
