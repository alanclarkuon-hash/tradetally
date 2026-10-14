jest.mock('fs/promises',()=>({lstat:jest.fn(),realpath:jest.fn(),mkdir:jest.fn(),open:jest.fn()}));
const fs=require('fs/promises'),path=require('path'),{prepare}=require('../../src/utils/prepareIgIngestion');
const root=path.resolve('synthetic-ingestion'),owner={enabled:'true',root,uid:1000,gid:1000};
let handle;
beforeEach(()=>{jest.resetAllMocks();fs.lstat.mockResolvedValue({isDirectory:()=>true,isSymbolicLink:()=>false});fs.realpath.mockResolvedValue(root);fs.mkdir.mockRejectedValue({code:'EEXIST'});handle={stat:jest.fn().mockResolvedValue({mode:0o755,isDirectory:()=>true}),chown:jest.fn().mockResolvedValue(),chmod:jest.fn().mockResolvedValue(),close:jest.fn().mockResolvedValue()};fs.open.mockResolvedValue(handle);});
test('repairs only the opened root-owned archive without touching statement files',async()=>{
 await prepare(owner);expect(fs.mkdir).toHaveBeenCalledWith(path.join(root,'Processed'));
 expect(handle.chown).toHaveBeenCalledWith(1000,1000);expect(handle.chmod).toHaveBeenCalledWith(0o755);expect(handle.close).toHaveBeenCalled();expect(fs.open).toHaveBeenCalledTimes(1);
});
test('disabled ingestion leaves all private folders untouched',async()=>{await prepare({...owner,enabled:'false'});expect(fs.lstat).not.toHaveBeenCalled();});
test('symlink archives are rejected before ownership can escape the inbox',async()=>{
 fs.lstat.mockResolvedValueOnce({isDirectory:()=>true,isSymbolicLink:()=>false}).mockResolvedValueOnce({isDirectory:()=>true,isSymbolicLink:()=>true});
 await expect(prepare(owner)).rejects.toThrow('Invalid archive');expect(fs.open).not.toHaveBeenCalled();
});
test('unexpected open-directory failures close the handle and do not touch files',async()=>{handle.chown.mockRejectedValue({code:'EPERM'});await expect(prepare(owner)).rejects.toEqual({code:'EPERM'});expect(handle.close).toHaveBeenCalled();expect(handle.chmod).not.toHaveBeenCalled();});
