// Refresh public calendar evidence, never customer data. Run manually and review
// the resulting diff before release. Runtime history checks do not use the network.
const fs=require('fs'),path=require('path');
const archive={
 2020:'https://www.info.gov.hk/gia/general/201905/17/P2019050800693.htm',
 2021:'https://www.info.gov.hk/gia/general/202005/15/P2020051300631p.htm',
 2022:'https://www.info.gov.hk/gia/general/202105/28/P2021052600332p.htm',
 2023:'https://www.info.gov.hk/gia/general/202205/13/P2022051000340.htm',
 2024:'https://www.info.gov.hk/gia/general/202305/25/P2023052500208p.htm'
};
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
async function read(url){const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Holiday source unavailable');return r.text();}
(async()=>{
 const years={},sources={...archive};
 for(const [year,url] of Object.entries(archive)){
  const html=await read(url),dates=[];
  for(const row of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
   const text=row[0].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
   const d=text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/);
   if(d)dates.push(`${year}-${String(months.indexOf(d[1])+1).padStart(2,'0')}-${d[2].padStart(2,'0')}`);
  }
  if(new Set(dates).size!==17)throw Error(`Unexpected holiday count for ${year}`);
  years[year]=[...new Set(dates)].sort();
 }
 const url='https://www.1823.gov.hk/common/ical/en.json';
 const current=JSON.parse((await read(url)).replace(/^\uFEFF/,''));
 for(const event of current.vcalendar[0].vevent){
  const value=event.dtstart[0],year=value.slice(0,4);
  if(!/^[0-9]{8}$/.test(value))throw Error('Invalid government holiday');
  (years[year] ||= []).push(`${year}-${value.slice(4,6)}-${value.slice(6,8)}`);sources[year]=url;
 }
 for(const [year,dates] of Object.entries(years)){years[year]=[...new Set(dates)].sort();if(years[year].length!==17)throw Error(`Unexpected holiday count for ${year}`);}
 const destination=path.join(__dirname,'../src/services/calendars/hkex-holidays.json');
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.writeFileSync(destination,JSON.stringify({sources,years},null,2)+'\n');
 console.log(`Reviewed holiday years available: ${Object.keys(years).join(', ')}`);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
