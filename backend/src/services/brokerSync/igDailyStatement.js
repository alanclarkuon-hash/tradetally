// Daily statement dates describe the reporting day, not the following print day.
const {cents,london}=require('./igStatement');
const {localToUTC}=require('../../utils/timezone');
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
function fail(reason){const e=new Error(reason);e.igReason=reason;throw e;}
function dateFromName(name){
 const m=String(name).match(/(?:^|\s)(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (20\d{2}) .*Statement(?: \(\d+\))?\.pdf$/i);
 return m?`${m[3]}-${String(months.findIndex(x=>x.toLowerCase()===m[2].toLowerCase())+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;
}
function identity(text){return {mask:text.match(/Account No\.\s*([A-Z0-9*]+)/)?.[1],label:text.match(/Account Name\s+([^\r\n]+)/)?.[1]?.trim()};}
function parse(text,date,base){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('invalid_date');
 const id=identity(text);
 if(!id.mask||id.mask!==base.statementMask||id.label!==base.statementLabel)fail('unknown_account');
 const print=text.match(/\b(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December) (20\d{2})\b/);
 if(!print)fail('unsupported_layout');
 const printDate=`${print[3]}-${String(months.findIndex(x=>x.startsWith(print[2]))+1).padStart(2,'0')}-${print[1]}`;
 const lag=(Date.parse(printDate)-Date.parse(date))/86400000;
 if(!Number.isFinite(lag)||lag<0||lag>4||date>new Date().toISOString().slice(0,10))fail('invalid_date');
 const amount=label=>{const hits=[...text.matchAll(new RegExp('(?:^|\\n)'+label+'\\s+(-?[\\d,]+(?:\\.\\d+)?)','g'))];if(hits.length!==1)fail('unsupported_layout');return cents(hits[0][1])/100;};
 const asOf=new Date(localToUTC(date+'T22:00:00','Europe/London')).toISOString();
 let cash,holdings,total,positions;
 if(base.kind==='spread_bet'){
  cash=amount('Funds');holdings=amount('Running Profit Or Loss');total=amount('Equity');
  try{positions=require('./igPdf').spreadPositions(text,asOf);}catch{fail('unsupported_positions');}
 }else if(base.kind==='share_dealing'){
  cash=amount('Cash balance GBP');holdings=amount('Value of GBP assets');total=amount('Total account value');
  const known=new Map([...(base.shareSecurities||[]),...(base.confirmation.holdings||[])].map(h=>[h.isin,h]));positions=[];
  const section=text.split('HOLDINGS GBP')[1]?.split(/-- \d+ of|GBP ACCOUNT ACTIVITY|EXCHANGE RATES/)[0];
  if(!section&&holdings!==0)fail('unsupported_positions');
  for(const line of (section||'').split('\n')){
   const m=line.match(/^(.+?)\s+([A-Z]{2}[A-Z0-9]{9}\d)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+-?[\d,.]+\s+-?[\d,.]+\s*$/);
   if(!m)continue;
   if(!known.has(m[2]))fail('new_share_execution_required');
   positions.push({...known.get(m[2]),isin:m[2],quantity:Number(m[3].replace(/,/g,'')),cost:cents(m[4])/100,value:cents(m[6])/100,asOf});
  }
  if(positions.reduce((s,p)=>s+cents(p.value),0)!==cents(holdings))fail('unsupported_positions');
 }else fail('unknown_account');
 if(cents(cash)+cents(holdings)!==cents(total))fail('equity_conflict');
 const records=[];let openingCash=null,activitySupported=true;
 const section=text.split(base.kind==='share_dealing'?'GBP ACCOUNT ACTIVITY':'CLOSED POSITIONS AND LEDGER')[1];
 if(section){
  const opening=section.match(/BALANCE\s+BROUGHT\s+FORWARD\s+(-?[\d,]+(?:\.\d+)?)/i);
  if(opening)openingCash=cents(opening[1])/100;
  const rows=[...section.matchAll(/(\d{2})([A-Z][a-z]{2})(\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([\s\S]*?)(?=\n\d{2}[A-Z][a-z]{2}\d{2}\s+\d{2}:\d{2}:\d{2}|\nBalance\s|\nIG is|$)/g)];
  for(const row of rows){
   const m=row[5].match(/^((?:CS)?\d+(?:\n\d+)*)\s+([\s\S]*?)\s+(DEPO|WITH|DIVIDEND|WITHHOLDING|INT|FEE)\s+GBP\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)\s*$/);
   if(!m){activitySupported=false;continue;}
   const description=m[2].replace(/\s+/g,' ').trim();let type;
   if(/^Cash Interest Paid\s+To Client/i.test(description))type='interest';
   else if(/Funds Transfer (?:to|from)/i.test(description))type=cents(m[4])>=0?'transfer_in':'transfer_out';
   else if(/Bank Deposit|Card payment/i.test(description)&&m[3]==='DEPO')type='deposit';
   else if(/Bank Withdrawal|Bank payment|Returned to card/i.test(description)&&m[3]==='WITH')type='withdrawal';
   else if(m[3]==='DIVIDEND')type='dividend';
   else if(/withholding/i.test(description))type='tax';
   else if(/Interest for|Stock Borrowing|CRPREM/i.test(description))type='account_fee';
   else{activitySupported=false;continue;}
   const month=months.findIndex(x=>x.startsWith(row[2]))+1;
   if(!month)fail('invalid_date');
   const time=london(`${row[1]}-${String(month).padStart(2,'0')}-20${row[3]} ${row[4]}`),amount=cents(m[4])/100;
   if((['interest','deposit','transfer_in','dividend'].includes(type)&&amount<0)||(['withdrawal','transfer_out','tax','account_fee'].includes(type)&&amount>0))fail('cash_conflict');
   if(time>new Date(localToUTC(date+'T23:59:59','Europe/London')).toISOString())fail('invalid_date');
   records.push({reference:'email:'+m[1].replace(/\s/g,''),time,date:time.slice(0,10),amount,cash:amount,type,
    description:type==='interest'?'Cash interest':type.startsWith('transfer_')?'Transfer between IG accounts':description,
    reportedBalance:cents(m[5])/100,source:'ig_email'});
  }
  if(openingCash!==null&&activitySupported){let balance=cents(openingCash);for(const r of records){balance+=cents(r.cash);if(balance!==cents(r.reportedBalance))fail('cash_conflict');}if(balance!==cents(cash))fail('cash_conflict');}
 }
 return {date,cash,holdings,total,asOf,positions,records,openingCash,activitySupported};
}
module.exports={parse,identity,dateFromName,fail};
