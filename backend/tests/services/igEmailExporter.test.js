const fs=require('fs'),path=require('path'),vm=require('vm');
const context={Utilities:{base64Decode:value=>[...Buffer.from(value,'base64')].map(n=>n>127?n-256:n)}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../scripts/ig-email-exporter.gs'),'utf8'),context);
test('accepts Advanced Gmail already decoded Byte arrays',()=>{expect([...context.decodeIgAttachment([37,80,68,70,-1])]).toEqual([37,80,68,70,-1]);});
test('decodes unpadded REST base64url attachments',()=>{const bytes=Buffer.from('%PDF\xff','latin1');expect([...context.decodeIgAttachment(bytes.toString('base64url'))]).toEqual([...bytes].map(n=>n>127?n-256:n));});
test('invalid byte arrays cannot become statement files',()=>{expect(()=>context.decodeIgAttachment([37,999])).toThrow('Invalid');});
