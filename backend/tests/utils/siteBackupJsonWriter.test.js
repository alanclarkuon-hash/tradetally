jest.mock('../../src/config/database',()=>({connect:jest.fn()}));
const fs=require('fs/promises'),os=require('os'),path=require('path');
const db=require('../../src/config/database'),{writeSiteBackupJson}=require('../../src/utils/siteBackupJsonWriter');
let root,file,client,batches;
beforeEach(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'site-backup-writer-'));file=path.join(root,'backup.json');batches=0;
 client={release:jest.fn(),query:jest.fn(async sql=>{
  if(sql.includes('information_schema'))return {rows:[{table_name:'users'},{table_name:'backups'}]};
  if(sql.startsWith('FETCH'))return {rows:batches++===0?[{id:'synthetic',preferences:{text:'false',value:false,n:3,empty:null}}]:[]};return {rows:[]};
 })};db.connect.mockResolvedValue(client);
});
afterEach(async()=>{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('site-backup-writer-'))throw Error('Unexpected cleanup target');await fs.rm(root,{recursive:true,force:true});});
test('streams valid JSON in bounded cursor batches with native types and a consistent snapshot',async()=>{
 expect(await writeSiteBackupJson(file)).toEqual({totalTables:1,totalRecords:1});
 const data=JSON.parse(await fs.readFile(file,'utf8'));expect(data.tables.users[0].preferences).toEqual({text:'false',value:false,n:3,empty:null});expect(data.statistics.totalRecords).toBe(1);
 expect(client.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');expect(client.query).toHaveBeenCalledWith('FETCH FORWARD 250 FROM tt_backup_rows');expect(client.query).toHaveBeenCalledWith('COMMIT');expect(client.release).toHaveBeenCalledTimes(1);
});
test('a failed table never publishes a partial backup and sanitizes the failure',async()=>{
 const original=client.query.getMockImplementation();client.query.mockImplementation(sql=>sql.startsWith('FETCH')?Promise.reject(Error('private connection data')):original(sql));
 await expect(writeSiteBackupJson(file)).rejects.toThrow('table "users"');expect(await fs.readdir(root)).toEqual([]);expect(client.query).toHaveBeenCalledWith('ROLLBACK');expect(client.release).toHaveBeenCalledTimes(1);
});
test('an existing completed backup cannot be overwritten',async()=>{
 await fs.writeFile(file,'original');await expect(writeSiteBackupJson(file)).rejects.toThrow('Backup export failed');expect(await fs.readFile(file,'utf8')).toBe('original');expect((await fs.readdir(root))).toEqual(['backup.json']);
});
