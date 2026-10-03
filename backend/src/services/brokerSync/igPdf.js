const {cents,csv}=require('./igStatement');
const {localToUTC}=require('../../utils/timezone');
const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
const reject=message=>{throw Error(`IG upload: ${message}`);};
async function text(buffer) {
  const marker=buffer.indexOf('%PDF');
  if(marker<0||marker>16)reject('Please upload an original IG PDF statement.');
  const {PDFParse}=require('pdf-parse');
  const parser=new PDFParse({data:new Uint8Array(buffer.subarray(marker)),isEvalSupported:false,enableXfa:false});
  try {
    const info=await parser.getInfo();
    if(info.total>30)reject('Please use a monthly PDF of 30 pages or fewer.');
    return (await parser.getText()).text;
  } finally {await parser.destroy();}
}
function identity(tradingText,ledgerText) {
  const compact=ledgerText.replace(/\s/g,'');
  if(!compact.includes('LedgerHistoryStatement'))reject('The monthly ledger PDF is missing.');
  const ledgerId=ledgerText.match(/AccountId:\s*([A-Z0-9]+)/)?.[1];
  const mask=tradingText.match(/Account No\.\s*([A-Z0-9*]+)/)?.[1];
  const label=tradingText.match(/Account Name\s+([^\r\n]+)/)?.[1]?.trim();
  if(!ledgerId||!mask||!label)reject('The PDFs do not contain a recognised IG account identity.');
  return {ledgerId,mask,label};
}
function confirmation(base,tradingText,ledgerText,transactions) {
  const id=identity(tradingText,ledgerText);
  if(id.ledgerId!==base.ledgerAccountId || id.mask!==base.statementMask || id.label!==base.statementLabel)
    reject('These PDFs belong to a different IG account.');
  const date=tradingText.match(/\b(\d{2}) (January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (20\d{2})\b/);
  if(!date)reject('The trading statement date could not be read.');
  const day=`${date[3]}-${String(months[date[2].slice(0,3)]).padStart(2,'0')}-${date[1]}`;
  const end=new Date(localToUTC(`${day}T23:59:59`,'Europe/London')).toISOString();
  const beginning=new Date(Date.parse(localToUTC(`${day}T00:00:00`,'Europe/London'))-1).toISOString();
  if(new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day)reject('Invalid statement date.');
  const value=tradingText.match(base.kind==='spread_bet'?/\bFunds\s+([\d,]+\.\d{2})/:/Cash balance GBP\s+([\d,]+\.\d{2})/)?.[1];
  if(!value)reject('The statement GBP cash balance could not be read.');
  const cash=cents(value)/100,rows=csv(transactions,'TextDate');
  const matches=cutoff=>rows.filter(r=>Date.parse(r.DateUtc+'Z')<=Date.parse(cutoff)).reduce((sum,r)=>sum+cents(r['PL Amount']),0)===cents(cash);
  // Share statements are headed with the next date but may close before its
  // early-morning interest credit. Verify against both actual cash cutoffs.
  const cutoff=matches(end)?end:matches(beginning)?beginning:null;
  if(!cutoff)reject('CSV cash does not match the trading statement. Upload full history and the matching statement.');
  if(cutoff.slice(0,10)<base.confirmation.cutoff.slice(0,10))reject('This trading statement is older than the last imported statement.');
  const holdings=[];
  if(base.kind==='spread_bet') {
    const running=tradingText.match(/Running Profit Or Loss\s+(-?[\d,]+\.\d{2})/)?.[1];
    const long=tradingText.match(/Total Long Positions\s+(-?[\d,]+\.\d{2})/)?.[1];
    const short=tradingText.match(/Total Short Positions\s+(-?[\d,]+\.\d{2})/)?.[1];
    if([running,long,short].some(v=>v==null||cents(v)!==0))reject('Open spread bets require additional position support. No import has been applied.');
  } else {
    const known=new Map((base.confirmation.holdings||[]).map(h=>[h.isin,h]));
    for(const line of tradingText.split('\n')) {
      const h=line.match(/^(.+?)\s+([A-Z]{2}[A-Z0-9]{9}\d)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+-?[\d,.]+\s+-?[\d,.]+\s*$/);
      if(!h)continue;
      if(!known.has(h[2]))reject('A new share holding needs its execution history before it can be imported.');
      const valuationDay=cutoff===beginning?new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10):day;
      const asOf=localToUTC(`${valuationDay}T22:00:00`,'Europe/London');
      holdings.push({...known.get(h[2]),quantity:Number(h[3].replace(/,/g,'')),cost:cents(h[4])/100,value:cents(h[6])/100,asOf:new Date(asOf).toISOString()});
    }
    const total=tradingText.match(/Value of GBP assets\s+([\d,]+\.\d{2})/)?.[1];
    if(total==null||holdings.reduce((sum,h)=>sum+cents(h.value),0)!==cents(total))reject('The holdings table could not be completely reconciled.');
  }
  return {cash,cutoff,holdings};
}
module.exports={text,identity,confirmation};
