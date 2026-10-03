const {cents,csv}=require('./igStatement');
const {localToUTC}=require('../../utils/timezone');
const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
const reject=message=>{throw Error(`IG upload: ${message}`);};
function spreadPositions(text,asOf) {
  const amount=label=>{const v=text.match(new RegExp(label+'\\s+(-?[\\d,]+\\.\\d{2})'))?.[1];
    if(v==null)reject('The spread-bet position summary is incomplete.');return cents(v)/100;};
  const running=amount('Running Profit Or Loss'),long=amount('Total Long Positions'),short=amount('Total Short Positions');
  const start=text.indexOf('FINANCIAL CURRENT OPEN POSITIONS');
  const section=start<0?'':text.slice(start).split(/Totals for deals|All currencies|CLOSED POSITIONS AND LEDGER/)[0];
  const positions=[],ids=new Set();
  // IG prints each bet as date, time, identity, market/stop lines, then its
  // currency and numeric valuation row. These are points and GBP stakes.
  const n='([+-]?[\\d,]+(?:\\.\\d+)?)';
  const pattern=new RegExp('(\\d{2})([A-Za-z]{3})(\\d{2})\\s*\\n(\\d{2}:\\d{2}:\\d{2})\\s*\\n([A-Z0-9]{8,})\\s*\\n([\\s\\S]*?)\\n(?:£|GBP)\\s+'+Array(7).fill(n).join('\\s+'),'g');
  for(const m of section.matchAll(pattern)) {
    const month=months[m[2]],day=`20${m[3]}-${String(month).padStart(2,'0')}-${m[1]}`;
    if(!month||!Number.isFinite(Date.parse(day+'T'+m[4]+'Z')))reject('An open bet has an invalid opening date.');
    const entryTime=new Date(localToUTC(day+'T'+m[4],'Europe/London')).toISOString();
    const stake=Number(m[7].replace(/,/g,'')),entryLevel=Number(m[8].replace(/,/g,'')),currentLevel=Number(m[9].replace(/,/g,''));
    const notional=cents(m[10])/100,margin=cents(m[11])/100,pnl=cents(m[12])/100;
    if(!stake||entryLevel<=0||currentLevel<=0||margin<0||ids.has(m[5])||entryTime>asOf||
      Math.abs(Math.round(Math.abs(stake)*currentLevel*100)-cents(notional))>1||
      Math.abs(Math.round(stake*(currentLevel-entryLevel)*100)-cents(pnl))>1)reject('An open bet valuation does not reconcile.');
    ids.add(m[5]);
    positions.push({betId:m[5],market:m[6].split('\n').filter(line=>!/^Stop |^Limit |^Page |^--/.test(line)).join(' ').trim(),
      quantity:Math.abs(stake),side:stake>0?'long':'short',entryLevel,currentLevel,notional,margin,unrealizedPnL:pnl,entryTime,asOf});
  }
  const sum=(side,key)=>positions.filter(p=>!side||p.side===side).reduce((s,p)=>s+cents(p[key]),0);
  if(sum(null,'unrealizedPnL')!==cents(running)||sum('long','notional')!==Math.abs(cents(long))||sum('short','notional')!==Math.abs(cents(short)))
    reject('The complete open-bet table is required to match the statement totals.');
  return positions;
}
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
  const holdings=[];let openBets;
  if(base.kind==='spread_bet') {
    openBets=spreadPositions(tradingText,new Date(localToUTC(`${day}T22:00:00`,'Europe/London')).toISOString());
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
  return {cash,cutoff,holdings,...(openBets?{openBets}:{})};
}
module.exports={text,identity,confirmation,spreadPositions};
