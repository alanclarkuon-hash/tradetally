const db=require('../config/database');
const fs=require('fs'),fsp=fs.promises,path=require('path'),crypto=require('crypto');
const {once}=require('events');
const {finished}=require('stream/promises');
const {toCamelCase}=require('./caseConvert');
const excluded=new Set(['backups','backup_settings','migrations','schema_migrations','api_cache']);
async function writeSiteBackupJson(filePath){
 let client,stream,completion,readingTable=null,temporary=null;
 try{
  client=await db.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const names=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>r.table_name).filter(n=>!excluded.has(n));
  if(names.some(n=>!/^[a-z_][a-z0-9_]*$/.test(n)))throw Error('Invalid table identifier');
  temporary=path.join(path.dirname(filePath),path.basename(filePath)+'.'+crypto.randomUUID()+'.partial');
  stream=fs.createWriteStream(temporary,{flags:'wx',mode:0o600});completion=finished(stream);completion.catch(()=>{});
  let streamError;stream.on('error',e=>{streamError=e;});
  const write=async value=>{if(streamError)throw streamError;if(!stream.write(value))await once(stream,'drain');};
  const mapping={},statistics={};let tableComma='',total=0;
  await write('{"version":"3.0","exportDate":'+JSON.stringify(new Date().toISOString())+',"tables":{');
  for(const name of names){
   readingTable=name;const key=toCamelCase(name);if(mapping[key])throw Error('Table mapping collision');mapping[key]=name;
   await write(tableComma+JSON.stringify(key)+':[');tableComma=',';
   await client.query(`DECLARE tt_backup_rows NO SCROLL CURSOR FOR SELECT * FROM "${name}"`);
   let rowComma='',count=0;
   for(;;){const batch=(await client.query('FETCH FORWARD 250 FROM tt_backup_rows')).rows;if(!batch.length)break;
    for(const row of batch){await write(rowComma+JSON.stringify(row));rowComma=',';count++;}
   }
   await client.query('CLOSE tt_backup_rows');await write(']');statistics[name]=count;total+=count;readingTable=null;
  }
  await write('},"tableNameMapping":'+JSON.stringify(mapping)+',"statistics":'+JSON.stringify({...statistics,totalTables:names.length,totalRecords:total})+'}');
  stream.end();await completion;await client.query('COMMIT');
  // Publish only a complete snapshot, preserving any existing destination.
  await fsp.link(temporary,filePath);await fsp.unlink(temporary);temporary=null;
  return {totalTables:names.length,totalRecords:total};
 }catch{
  stream?.destroy();if(completion)await completion.catch(()=>{});
  try{if(client)await client.query('ROLLBACK');}catch{}
  if(temporary)await fsp.unlink(temporary).catch(()=>{});
  throw Error(readingTable?`Backup export failed while reading table "${readingTable}". No complete backup was created.`:'Backup export failed. No complete backup was created.');
 }finally{client?.release();}
}
module.exports={writeSiteBackupJson};
