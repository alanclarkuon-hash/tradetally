const {SaxesParser}=require('saxes');
const path=require('path').posix;
const yauzl=require('yauzl');
const {statementDate}=require('./etoroStatement');
const fail=message=>{throw Error(`eToro upload: ${message}`);};
async function validateZip(buffer) {
  if(!Buffer.isBuffer(buffer)||buffer.length<4||buffer.length>10*1024*1024||buffer.readUInt32LE(0)!==0x04034b50)fail('Choose an XLSX statement of 10 MB or less.');
  return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(error);
    let entries=0,total=0;const files=new Map();
    const stop=e=>{zip.close();reject(e);};
    zip.on('error',stop);zip.on('end',()=>resolve(files));
    zip.on('entry',entry=>{
      if(++entries>1000||entry.uncompressedSize>64*1024*1024||/vbaProject|externalLinks|embeddings/i.test(entry.fileName))return stop(Error('Unsafe or oversized workbook'));
      if(entry.fileName.endsWith('/'))return zip.readEntry();
      zip.openReadStream(entry,(e,stream)=>{
        if(e)return stop(e);
        const chunks=[];const keep=/^xl\/(workbook.xml|_rels\/workbook.xml.rels|sharedStrings.xml|worksheets\/[^/]+\.xml)$/.test(entry.fileName);
        if(files.has(entry.fileName))return stop(Error('Duplicate workbook entry'));
        stream.on('error',stop);stream.on('data',chunk=>{total+=chunk.length;if(total>64*1024*1024){stream.destroy();stop(Error('Oversized workbook'));}else if(keep)chunks.push(chunk);});
        stream.on('end',()=>{if(keep)files.set(entry.fileName,Buffer.concat(chunks).toString('utf8'));zip.readEntry();});
        stream.resume();
      });
    });zip.readEntry();
  })).catch(()=>fail('The workbook is invalid or too large when expanded. Download a fresh XLSX statement.'));
}
function xml(source,open,text,close) {
  if(source==null)fail('Missing workbook data.');
  const parser=new SaxesParser({xmlns:true});
  parser.on('doctype',()=>fail('Unsupported workbook XML.'));
  parser.on('opentag',open);parser.on('text',text||(()=>{}));parser.on('closetag',close||(()=>{}));
  try{parser.write(source).close();}catch(e){if(e.message.startsWith('eToro upload:'))throw e;fail('Invalid workbook XML. Download the original export again.');}
}
const attr=(node,name)=>Object.values(node.attributes).find(a=>a.local===name)?.value;
function rows(source,strings) {
  const result=[];let row,cell,collect=false;
  xml(source,node=>{
    if(node.local==='row'){if(result.length>=100001)fail('Oversized cashflow sheet.');row=[];}
    if(node.local==='c'){
      const ref=attr(node,'r');const match=/^([A-Z]+)([1-9]\d*)$/.exec(ref||'');if(!row||!match)fail('Invalid workbook cell.');
      const col=[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
      if(col>=30||row[col]!==undefined)fail('Oversized or duplicate workbook column.');cell={col,type:attr(node,'t'),text:''};
    }
    if(node.local==='f')fail('The statement contains unsupported cell values. Upload the original eToro export.');
    if(cell&&(node.local==='v'||node.local==='t'))collect=true;
  },text=>{if(collect&&cell)cell.text+=text;},node=>{
    if(node.local==='v'||node.local==='t')collect=false;
    if(node.local==='c'){
      let v=cell.text;
      if(cell.type==='s'){if(!/^\d+$/.test(v)||strings[Number(v)]===undefined)fail('Invalid workbook text reference.');v=strings[Number(v)];}
      else if(!cell.type||cell.type==='n'){v=v===''?null:Number(v);if(v!==null&&!Number.isFinite(v))fail('Invalid workbook number.');}
      else if(cell.type==='b')v=v==='1';
      else if(!['inlineStr','str'].includes(cell.type))fail('The statement contains unsupported cell values. Upload the original eToro export.');
      row[cell.col]=v;cell=null;
    }
    if(node.local==='row'){result.push(row);row=null;}
  });return result;
}
async function read(buffer) {
  const files=await validateZip(buffer);const sheets=new Map(),rels=new Map(),strings=[];
  xml(files.get('xl/workbook.xml'),n=>{if(n.local==='sheet')sheets.set(attr(n,'name'),attr(n,'id'));});
  xml(files.get('xl/_rels/workbook.xml.rels'),n=>{if(n.local==='Relationship'&&attr(n,'TargetMode')!=='External')rels.set(attr(n,'Id'),attr(n,'Target'));});
  if(files.has('xl/sharedStrings.xml')){let s=null,collect=false;xml(files.get('xl/sharedStrings.xml'),n=>{if(n.local==='si')s='';if(n.local==='t')collect=true;},t=>{if(collect&&s!==null)s+=t;},n=>{if(n.local==='t')collect=false;if(n.local==='si'){strings.push(s);s=null;}});}
  const sheet=name=>{const target=rels.get(sheets.get(name));if(!target)fail(`Missing ${name} sheet.`);const location=target.startsWith('/')?target.slice(1):path.normalize(path.join('xl',target));if(!/^xl\/worksheets\/[^/]+\.xml$/.test(location))fail('Invalid workbook sheet reference.');return rows(files.get(location),strings);};
  const controls={};for(const row of sheet('Account Summary')){const label=row[0];if(['Username','Currency','Start Date','End Date'].includes(label)){if(label in controls)fail('Duplicate account summary field.');controls[label]=row[1];}}
  // eToro labels USD reports with GBP display columns as USD/GBP. The
  // saved USD ledger and exact overlapping cash deltas establish the unit.
  if(typeof controls.Username!=='string'||!controls.Username.trim()||!['USD','USD/GBP'].includes(controls.Currency))fail('This workflow requires an eToro USD investment-account statement.');
  const start=statementDate(controls['Start Date']),end=statementDate(controls['End Date']);
  if(!start.endsWith('T00:00:00.000Z')&&!start.endsWith('T00:00:00Z'))fail('Download a statement starting at the beginning of a day.');
  if(end<start)fail('Invalid statement dates.');
  if(!end.endsWith('T23:59:59.000Z'))fail('Download a statement ending at the end of a day.');
  const statement={};
  for(const name of ['Account Activity','Dividends']) {
    const data=sheet(name);const headers=Array.from(data[0]||[],v=>typeof v==='string'?v.trim():v);
    if(!headers.length||headers.some(h=>!h)||new Set(headers).size!==headers.length)fail('Invalid statement column headings.');
    statement[name]=data.slice(1).filter(row=>row.some(v=>v!=null&&v!=='')).map(row=>{const record={};headers.forEach((h,c)=>{record[h]=row[c]??null;});return record;});
  }
  const required=['Date','Type','Amount','Balance','Position ID','Realized Equity Change'];
  if(!statement['Account Activity'].length||required.some(k=>!(k in statement['Account Activity'][0])))fail('Missing account-activity fields.');
  for(const row of statement['Account Activity']){const time=statementDate(row.Date);if(time<start||time>end)fail('Activity lies outside the statement period.');}
  return {statement,username:controls.Username.trim().toLowerCase(),start:start.slice(0,10),end:end.slice(0,10)};
}
module.exports={read,validateZip};
