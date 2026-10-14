jest.mock('axios');
const axios=require('axios');
const provider=require('../../src/services/stockAnalysisHistory');
const html=symbol=>`info:{type:"stocks",symbol:"${symbol.toLowerCase()}",ticker:"${symbol}",exchange:"NASDAQ",nameFull:"Synthetic security",curr:{main:"USD",price:"USD"}} data:{data:{source:"tiingo"}}`;
const row=(t,c=100)=>({t,o:c,h:c,l:c,c,v:100,a:c/2});
let clock=Date.now();
beforeEach(()=>jest.spyOn(Date,'now').mockImplementation(()=>clock+=5000));
afterEach(()=>{jest.clearAllMocks();jest.restoreAllMocks();});
test('reads public split-adjusted Close, not dividend-adjusted Adj. Close, and excludes delisting sentinel',async()=>{
 axios.get.mockResolvedValueOnce({data:html('ZZTEST1')}).mockResolvedValueOnce({data:{data:[row('2023-01-03'),{...row('2023-01-04'),v:1}]}});
 const data=await provider.download('ZZTEST1');expect(data.prices).toEqual([{date:'2023-01-03',close:100}]);expect(axios.get.mock.calls[1][1].params).toEqual({range:'5Y',period:'Daily'});
});
test('rejects a renamed or reused symbol returned by the source',async()=>{
 axios.get.mockResolvedValueOnce({data:html('DIFFERENT')});await expect(provider.download('ZZTEST2')).rejects.toThrow('identity mismatch');expect(axios.get).toHaveBeenCalledTimes(1);
});
test('rejects foreign quote currency masquerading as USD',async()=>{
 axios.get.mockResolvedValueOnce({data:html('ZZTEST3').replace('price:"USD"','price:"EUR"')});await expect(provider.download('ZZTEST3')).rejects.toThrow('identity mismatch');
});
test('only recovers quotes with independent native basis evidence and reverses known later splits',()=>{
 const data={currency:'USD',prices:[{date:'2023-01-03',close:50},{date:'2023-01-04',close:51},{date:'2023-03-01',close:52}]};const cached={currency:'USD',splits:[{date:'2023-02-01',ratio:2}],prices:[{date:'2023-01-03',close:100}]};
 expect(provider.verifiedRows(data,'2023-01-01','2023-03-02',cached)).toEqual([{date:'2023-01-04',close:102}]);expect(provider.verifiedRows(data,'2023-01-01','2023-03-02',null)).toEqual([]);
});
test('rejects unmatched quote basis and preserves already cached dates',()=>{
 const data={currency:'USD',prices:[{date:'2023-01-03',close:100},{date:'2023-01-04',close:101}]};expect(provider.verifiedRows(data,'2023-01-01','2023-01-05',{currency:'USD',prices:[{date:'2023-01-03',close:10}]})).toEqual([]);
});
test('foreign listings retain exchange namespace and crypto/contracts are not proxies',()=>{
 expect(provider.route('00011.HK')).toEqual({path:'/quote/hkg/0011/history/',ticker:'0011',venue:'HKG',currency:'HKD',type:'a'});expect(()=>provider.route('CHINA50.FUTURE')).toThrow();expect(()=>provider.route('WOLF.OLD')).toThrow();
});
test('hydration reader treats embedded script text as data rather than executing it',()=>{
 const value=provider.literalObject('x:{ticker:"};process.exit()",nested:{value:1}} tail',2);expect(provider.stringField(value,'ticker')).toBe('};process.exit()');expect(()=>provider.literalObject('{bad',0)).toThrow();
});

test('explicit no-split evidence permits a full range in native units without cached overlap',()=>{
 const data={currency:'USD',unadjustedAfter:'1900-01-01',prices:[{date:'2023-01-03',close:100}]};expect(provider.verifiedRows(data,'2023-01-01','2023-01-05',null)).toEqual(data.prices);
 expect(provider.verifiedRows(data,'2023-01-01','2023-01-05',{currency:'USD',splits:[{date:'2024-01-01',ratio:2}]})).toEqual([]);
});
test('last-split evidence cannot establish the unit basis for earlier dates',()=>{
 const data={currency:'USD',unadjustedAfter:'2023-01-04',prices:[{date:'2023-01-03',close:100},{date:'2023-01-05',close:101}]};expect(provider.verifiedRows(data,'2023-01-01','2023-01-06',null)).toEqual([data.prices[1]]);
});

test('accepts explicit split facts only when statistics identify the same security and currency',async()=>{
 const table='<main><p>This stock does not have any record of stock splits.</p><table><tr><td>Last Split Date</td><td>n/a</td></tr><tr><td>Split Type</td><td>n/a</td></tr><tr><td>Split Ratio</td><td>n/a</td></tr></table></main>';
 const data={ticker:'ZZTEST4',exchange:'NASDAQ',currency:'USD',name:'Synthetic security',path:'/stocks/zztest4/history/'};
 axios.get.mockResolvedValueOnce({data:html('ZZTEST4')+table});await provider.splitProof(data);expect(data.unadjustedAfter).toBe('1900-01-01');
 const different={...data,proofPromise:undefined,unadjustedAfter:undefined};axios.get.mockResolvedValueOnce({data:html('DIFFERENT')+table});await provider.splitProof(different);expect(different.unadjustedAfter).toBeUndefined();
});

test('native prices with unidentified units cannot establish the unit of a fallback',()=>{
 const data={currency:'USD',unadjustedAfter:'1900-01-01',prices:[{date:'2023-01-03',close:100}]};expect(provider.verifiedRows(data,'2023-01-01','2023-01-05',{prices:[{date:'2022-01-03',close:100}]})).toEqual([]);
});
test('blank split fields without an explicit source statement remain unverified',async()=>{
 const data={ticker:'ZZTEST5',exchange:'NASDAQ',currency:'USD',name:'Synthetic security',path:'/stocks/zztest5/history/'};axios.get.mockResolvedValueOnce({data:html('ZZTEST5')+'<main><table><tr><td>Last Split Date</td><td>n/a</td></tr><tr><td>Split Type</td><td>n/a</td></tr><tr><td>Split Ratio</td><td>n/a</td></tr></table></main>'});await provider.splitProof(data);expect(data.unadjustedAfter).toBeUndefined();
});

test('unavailable listings are not re-requested for each missing range',async()=>{
 axios.get.mockRejectedValue({response:{status:404}});await expect(provider.download('ZZMISSING')).rejects.toEqual({response:{status:404}});await expect(provider.download('ZZMISSING')).rejects.toEqual({response:{status:404}});expect(axios.get).toHaveBeenCalledTimes(2);
});
test('a rate-limit response prevents requests for other symbols during cooldown',async()=>{
 axios.get.mockRejectedValueOnce({response:{status:429,headers:{'retry-after':'120'}}});await expect(provider.download('ZZLIMIT1')).rejects.toEqual({response:{status:429,headers:{'retry-after':'120'}}});await expect(provider.download('ZZLIMIT2')).rejects.toThrow('rate-limit cooldown');expect(axios.get).toHaveBeenCalledTimes(1);
});


test('verified merger history keeps adjusted chart candles distinct from original-share prices',async()=>{
 clock+=180000;
 const days=['2026-07-20','2026-07-21','2026-07-22'];
 const page=html('AVB').replace('NASDAQ','NYSE').replace('Synthetic security','AvalonBay Communities, Inc.');
 const table='<main><p>This stock does not have any record of stock splits.</p><table><tr><td>Last Split Date</td><td>n/a</td></tr><tr><td>Split Type</td><td>n/a</td></tr><tr><td>Split Ratio</td><td>n/a</td></tr></table></main>';
 axios.get.mockResolvedValueOnce({data:page}).mockResolvedValueOnce({data:{data:[row('2021-11-03',10),...days.map((d,i)=>row(d,100+i))]}}).mockResolvedValueOnce({data:page+table});
 const cached={currency:'USD',splits:[{date:'2026-08-17',ratio:2.793}],prices:days.map((date,i)=>({date,close:(100+i)*2.793}))};
 const r=await provider.verified('AVB','2021-11-03','2021-11-03',cached);
 expect(r.prices).toEqual([{date:'2021-11-03',close:27.93}]);expect(r.candles[0].close).toBe(10);expect(r.historicalIdentity).toMatchObject({symbol:'AVB',successor:'VMRK',nativeAnchorCount:3});
});

test('TXSE continuous history retains native pre-transfer rows with exact issuer and split proof',async()=>{
 clock+=180000;
 const page=html('ET').replace('NASDAQ','TXSE').replace('Synthetic security','Energy Transfer LP');
 const table='<main><table><tr><td>Last Split Date</td><td>Jul 27, 2015</td></tr><tr><td>Split Type</td><td>Forward</td></tr><tr><td>Split Ratio</td><td>2:1</td></tr></table></main>';
 const days=['2026-07-20','2026-07-21','2026-07-22'],cached={currency:'USD',splits:[],prices:days.map((date,i)=>({date,close:100+i}))};
 axios.get.mockResolvedValueOnce({data:page}).mockResolvedValueOnce({data:{data:[row('2021-11-23',10),...days.map((d,i)=>row(d,100+i))]}}).mockResolvedValueOnce({data:page+table});
 const r=await provider.verified('ET','2021-11-23','2021-11-23',cached);expect(r.prices).toEqual([{date:'2021-11-23',close:10}]);expect(r.historicalIdentity).toMatchObject({kind:'exchange-transfer',nativeAnchorCount:3});
});


describe('fallback split calendar dates',()=>{
 test.each([['Jun 10, 2024','2024-06-10'],['January 2, 2024','2024-01-02'],['Feb 29, 2024','2024-02-29'],['Feb 29, 2000','2000-02-29'],['Jul 27, 2015','2015-07-27'],['2024-06-10','2024-06-10'],['  Dec 31, 2024  ','2024-12-31']])('preserves %s as a calendar day',(text,expected)=>{
  expect(provider.parseCalendarDate(text)).toBe(expected);
 });
 test.each(['Feb 29, 2023','Feb 29, 1900','Jun 31, 2024','2024-02-30','2024-13-01','2024-00-01','Jun 0, 2024','Jun 32, 2024','Junk 10, 2024','06/10/2024','10 Jun 2024','Jun 10, 24','2024-06-10T00:00:00Z','n/a','',null,123])('rejects invalid or ambiguous label %s',text=>{
  expect(provider.parseCalendarDate(text)).toBeNull();
 });
 test.each(['UTC','Europe/London','America/New_York','Asia/Tokyo'])('is independent of host timezone %s',tz=>{
  const {execFileSync}=require('child_process');
  const labels=['Jun 10, 2024','Jan 10, 2024','Mar 31, 2024','Oct 27, 2024','Feb 29, 2024','Jul 27, 2015','Jun 31, 2024'];
  const script=`console.log=()=>{};const p=require(${JSON.stringify(require.resolve('../../src/services/stockAnalysisHistory'))});process.stdout.write(JSON.stringify(${JSON.stringify(labels)}.map(p.parseCalendarDate)));`;
  const result=execFileSync(process.execPath,['-e',script],{env:{...process.env,TZ:tz},encoding:'utf8'});
  expect(JSON.parse(result)).toEqual(['2024-06-10','2024-01-10','2024-03-31','2024-10-27','2024-02-29','2015-07-27',null]);
 });
 test.each(['Jun 10, 2024','Jun 31, 2024'])('split proof respects the stated boundary for %s',async last=>{
  clock+=180000;
  const data={ticker:'ZZDATE',exchange:'NASDAQ',currency:'USD',name:'Synthetic security',path:'/stocks/zzdate/history/',prices:[{date:'2024-06-09',close:100},{date:'2024-06-10',close:50}]};
  const table=`<main><table><tr><td>Last Split Date</td><td>${last}</td></tr><tr><td>Split Type</td><td>Forward</td></tr><tr><td>Split Ratio</td><td>2:1</td></tr></table></main>`;
  axios.get.mockResolvedValueOnce({data:html('ZZDATE')+table});await provider.splitProof(data);
  expect(data.unadjustedAfter).toBe(last==='Jun 10, 2024'?'2024-06-10':undefined);
  expect(provider.verifiedRows(data,'2024-06-09','2024-06-10',null)).toEqual(last==='Jun 10, 2024'?[data.prices[1]]:[]);
 });
});
