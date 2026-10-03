const axios = require('axios');
const {inflateRawSync,crc32} = require('zlib');
// Official archive linked from Kraken's historical OHLCVT support article.
// Fetch only the ZIP index and selected daily CSV, not the multi-GB archive.
const BASE = 'https://assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full_2026Q2.zip.part';
const PARTS = 5;
const MAX_RANGE = 2 * 1024 * 1024;
async function range(part,start,end) {
  if (!Number.isInteger(part) || part<0 || part>=PARTS || !Number.isSafeInteger(start) || start<0 ||
      !Number.isSafeInteger(end) || end<start || end-start+1>MAX_RANGE) throw Error('Invalid Kraken archive range');
  const response = await axios.get(BASE+String(part).padStart(2,'0'),{headers:{Range:`bytes=${start}-${end}`},
    responseType:'arraybuffer',timeout:30000,maxRedirects:0,maxContentLength:MAX_RANGE});
  const match=String(response.headers['content-range']||'').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if(response.status!==206 || !match || Number(match[1])!==start || Number(match[2])!==end || response.data.byteLength!==end-start+1)
    throw Error('Kraken archive server did not honor the bounded range');
  return {bytes:Buffer.from(response.data),size:Number(match[3])};
}
function directoryLocation(tail) {
  const i=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x06,0x06]));
  if(i<0 || i+56>tail.length || tail.readUInt32LE(i+16)!==0 || tail.readUInt32LE(i+20)!==0)
    throw Error('Unsupported Kraken ZIP64 index');
  const size=Number(tail.readBigUInt64LE(i+40)),offset=Number(tail.readBigUInt64LE(i+48));
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||size<=0||size>MAX_RANGE)throw Error('Invalid Kraken ZIP directory');
  return {offset,size};
}
function findEntry(directory,name) {
  for(let i=0;i<directory.length;) {
    if(i+46>directory.length || directory.readUInt32LE(i)!==0x02014b50)throw Error('Invalid Kraken ZIP directory entry');
    const nameLength=directory.readUInt16LE(i+28),extraLength=directory.readUInt16LE(i+30),commentLength=directory.readUInt16LE(i+32);
    const end=i+46+nameLength+extraLength+commentLength;
    if(end>directory.length)throw Error('Truncated Kraken ZIP directory');
    const filename=directory.subarray(i+46,i+46+nameLength).toString('utf8');
    if(filename===name) {
      let compressed=directory.readUInt32LE(i+20),size=directory.readUInt32LE(i+24),offset=directory.readUInt32LE(i+42);
      let extra=i+46+nameLength;
      while(extra<i+46+nameLength+extraLength) {
        const type=directory.readUInt16LE(extra),length=directory.readUInt16LE(extra+2);let field=extra+4;
        if(field+length>i+46+nameLength+extraLength)throw Error('Invalid Kraken ZIP extra field');
        if(type===1) {
          for(const key of ['size','compressed','offset']) {
            const value={size,compressed,offset}[key];if(value!==0xffffffff)continue;
            if(field+8>extra+4+length)throw Error('Truncated Kraken ZIP64 entry');
            const n=Number(directory.readBigUInt64LE(field));field+=8;
            if(key==='size')size=n;else if(key==='compressed')compressed=n;else offset=n;
          }
        }
        extra+=4+length;
      }
      if([size,compressed,offset].some(x=>!Number.isSafeInteger(x)||x<0) || size>MAX_RANGE || compressed>MAX_RANGE ||
         directory.readUInt16LE(i+10)!==8 || directory.readUInt16LE(i+8)&1)throw Error('Unsupported Kraken daily ZIP entry');
      return {size,compressed,offset,crc:directory.readUInt32LE(i+16),name:filename};
    }
    i=end;
  }
  throw Error('Requested daily pair is absent from Kraken archive');
}
async function dailyPrices(pair) {
  if(!/^[A-Z0-9]{3,20}$/.test(pair))throw Error('Invalid Kraken archive pair');
  const sizes=[];
  for(let part=0;part<PARTS;part++)sizes.push((await range(part,0,0)).size);
  const total=sizes.reduce((a,b)=>a+b,0);
  async function read(offset,size) {
    if(offset<0 || size<=0 || size>MAX_RANGE || offset+size>total)throw Error('Invalid archive span');
    const buffers=[];let base=0;
    for(let part=0;part<PARTS&&size>0;part++) {
      const partEnd=base+sizes[part];
      if(offset<partEnd) {
        const start=offset-base,count=Math.min(size,sizes[part]-start);
        buffers.push((await range(part,start,start+count-1)).bytes);offset+=count;size-=count;
      }
      base=partEnd;
    }
    return Buffer.concat(buffers);
  }
  const tail=await read(total-65536,65536),directory=directoryLocation(tail);
  const entry=findEntry(await read(directory.offset,directory.size),`${pair}_1440.csv`);
  const header=await read(entry.offset,30);
  if(header.readUInt32LE(0)!==0x04034b50)throw Error('Invalid Kraken ZIP local header');
  const nameLength=header.readUInt16LE(26),extraLength=header.readUInt16LE(28);
  const name=await read(entry.offset+30,nameLength);
  if(name.toString('utf8')!==entry.name)throw Error('Kraken ZIP file identity mismatch');
  const bytes=inflateRawSync(await read(entry.offset+30+nameLength+extraLength,entry.compressed),{maxOutputLength:MAX_RANGE});
  if(bytes.length!==entry.size || crc32(bytes)!==entry.crc)throw Error('Kraken archive CSV checksum mismatch');
  const prices={};
  for(const line of bytes.toString('utf8').trim().split(/\r?\n/)) {
    const fields=line.split(',');const time=Number(fields[0]),price=Number(fields[4]);
    if(fields.length!==7 || !Number.isSafeInteger(time) || !(price>0))throw Error('Invalid Kraken archived candle');
    const date=new Date(time*1000).toISOString().slice(0,10);
    if(prices[date]!==undefined)throw Error('Duplicate Kraken archived daily candle');
    prices[date]=price;
  }
  return {prices,source:'Kraken official OHLCVT archive 2026Q2, daily UTC close',pair};
}
module.exports={dailyPrices,directoryLocation,findEntry};
