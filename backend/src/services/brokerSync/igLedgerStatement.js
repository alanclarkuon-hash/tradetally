const {cents}=require('./igStatement'),{fail}=require('./igDailyStatement');
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const compact=s=>s.replace(/\s/g,'');
function date(s){const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);if(!m)fail('invalid_date');const d=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;if(new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)fail('invalid_date');return d;}
function lines(items){const out=[];for(const i of [...items].sort((a,b)=>b.y-a.y||a.x-b.x)){let row=out.find(r=>Math.abs(r.y-i.y)<.7);if(!row){row={y:i.y,items:[]};out.push(row);}row.items.push(i);}for(const r of out)r.items.sort((a,b)=>a.x-b.x);return out;}
function indexed(row){let text='',positions=[];for(const i of row.items){for(const [n,c]of [...i.text].entries())if(!/\s/.test(c)){text+=c;positions.push(i.x+i.width*n/i.text.length);}}return {text,positions};}
function parse(text,pages){
 if(!compact(text).includes('LedgerHistoryStatement'))fail('unsupported_layout');
 const account=text.match(/Account\s*Id:\s*([A-Z0-9]+)\b/)?.[1],period=text.match(/Ledger\s*Period:\s*(\d{1,2}\/\d{1,2}\/20\d{2})\s*to\s*(\d{1,2}\/\d{1,2}\/20\d{2})/);
 if(!account||[...text.matchAll(/Account\s*Id:\s*([A-Z0-9]+)\b/g)].some(m=>m[1]!==account))fail('unknown_account');if(!period)fail('invalid_date');const from=date(period[1]),to=date(period[2]);if(from>to||to>new Date().toISOString().slice(0,10))fail('invalid_date');
 const records=[],seen=new Set();let previousTime=null;
 for(const items of pages){const rows=lines(items),header=rows.find(r=>indexed(r).text.includes('TransactionDateTypeReference'));if(!header){if(items.some(i=>/^\d{2}[A-Z][a-z]{2}\d{2}/.test(compact(i.text))))fail('unsupported_layout');continue;}
  const labels=['TransactionDate','Type','Reference','OpenedDealID','MarketName','Prompt','Direction','Currency','Size','Opening','Closing','P&L'];
  const starts=labels.map(l=>{const candidate=rows.filter(r=>r.y>=header.y-.7).map(indexed).find(r=>r.text.includes(l));if(!candidate)fail('unsupported_layout');return candidate.positions[candidate.text.indexOf(l)];});if(starts.some((x,i)=>i&&x<=starts[i-1]))fail('unsupported_layout');
  const boundaries=starts.map((s,i)=>i>=8?(s+starts[i-1])/2:s-2);let current=null;
  const flush=()=>{if(!current)return;const c=current.map(compact);const m=c[0].match(/^(\d{2})([A-Z][a-z]{2})(\d{2})(\d{2}:\d{2}:\d{2})UTC([+-])(\d{1,2})$/);
   if(!m||!months.includes(m[2])||Number(m[6])>14)fail('invalid_date');
   const local=`20${m[3]}-${String(months.indexOf(m[2])+1).padStart(2,'0')}-${m[1]}`,offset=m[5]+m[6].padStart(2,'0')+':00';
   if(new Date(local+'T00:00:00Z').toISOString().slice(0,10)!==local||local<from||local>to)fail('invalid_date');const time=new Date(local+'T'+m[4]+offset).toISOString();
   if(previousTime&&time>previousTime)fail('unsupported_layout');previousTime=time;
   if(!/^CS\d+$/.test(c[2])||seen.has(c[2]))fail('cash_conflict');seen.add(c[2]);
   if(c[7]!=='GBP'||c[3]||c[5]||!['+','-'].includes(c[6])||c[8]!=='0.00'||!/^0(?:\.0+)?$/.test(c[9])||!/^0(?:\.0+)?$/.test(c[10]))fail('ledger_unsupported_activity');
   let type,description;if(/^CashInterestPaidToClient/i.test(c[4])&&['DEPO','INT'].includes(c[1])){type='interest';description='Cash interest';}
   else if(/^(?:BankWithdrawal|Bankpayment|Returnedtocard)$/i.test(c[4])&&c[1]==='WITH'){type='withdrawal';description='Bank or card withdrawal';}
   else if(/^(?:BankDeposit|Cardpayment)$/i.test(c[4])&&c[1]==='DEPO'){type='deposit';description='Bank or card deposit';}
   else fail('ledger_unsupported_activity');
   const amount=cents(c[11])/100;if((amount>=0)!==(c[6]==='+')||(['interest','dividend','deposit','transfer_in'].includes(type)&&amount<0)||(['tax','account_fee','withdrawal','transfer_out'].includes(type)&&amount>0))fail('cash_conflict');
   records.push({reference:'email:'+c[2],time,date:time.slice(0,10),amount,cash:amount,type,description,source:'ig_email',ledgerReference:c[2]});current=null;
  };
  const body=rows.filter(r=>r.y<header.y-.7).map(r=>{const cells=Array.from({length:12},()=> '');for(const i of r.items){let col=11;while(col>0&&i.x<boundaries[col])col--;cells[col]+=i.text;}return {y:r.y,cells};});
  const anchors=body.filter(r=>/^\d{2}[A-Z][a-z]{2}\d{2}/.test(compact(r.cells[0]))).map(r=>({y:r.y,cells:Array.from({length:12},()=> '')}));
  for(const r of body){if(/^Level(?:Level)?$/.test(compact(r.cells.join(''))))continue;if(!anchors.length)fail('unsupported_layout');
   const nearest=[...anchors].sort((a,b)=>Math.abs(a.y-r.y)-Math.abs(b.y-r.y))[0];if(Math.abs(nearest.y-r.y)>10)fail('unsupported_layout');
   for(let i=0;i<12;i++)nearest.cells[i]+=r.cells[i];
  }
  for(const a of anchors){current=a.cells;flush();}

 }
 if(!records.length)fail('unsupported_layout');return {kind:'ledger',account,from,to,records:records.sort((a,b)=>a.time.localeCompare(b.time)||a.reference.localeCompare(b.reference))};
}
async function read(buffer,text){return parse(text,await require('./igPdf').ledgerGeometry(buffer));}
module.exports={parse,read,lines};
