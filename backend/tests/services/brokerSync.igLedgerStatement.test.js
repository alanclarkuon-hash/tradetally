const {parse}=require('../../src/services/brokerSync/igLedgerStatement');
const {merge}=require('../../src/services/brokerSync/igEmailCash');
const text='Ledger History Statement Account Id: DEMO1 Ledger Period: 1/01/2026 to 14/01/2026';
const xs=[10,150,190,270,330,480,530,570,610,660,710,790];
const labels=['TransactionDate','Type','Reference','OpenedDealID','MarketName','Prompt','Direction','Currency','Size','Opening','Closing','P&L'];
const item=(text,x,y)=>({text,x,y,width:text.length*2});
function page({reference='CS123456789',amount='0.11',currency='GBP',market='Cash Interest Paid To Client - Jan 26',when='10 Jan 26 05:15:11 UTC+1',wrapped=false,type='DEPO',direction='+'}={}){
 const cells=[when,type,reference,'',market,'',direction,currency,'0.00','0','0',amount];
 const items=labels.map((v,i)=>item(v,xs[i],i===9||i===10?205:200));
 cells.forEach((v,i)=>{if(!v)return;if(i===2&&wrapped){items.push(item(v.slice(0,-1),xs[i],153.3),item(v.slice(-1),xs[i],146.1));}else items.push(item(v,xs[i],150));});
 return items;
}
test('extracts account, native reference, dated currency amount and explicit UTC offset from geometry',()=>{
 const result=parse(text,[page({wrapped:true})]);expect(result).toMatchObject({kind:'ledger',account:'DEMO1',from:'2026-01-01',to:'2026-01-14'});
 expect(result.records).toEqual([expect.objectContaining({reference:'email:CS123456789',ledgerReference:'CS123456789',time:'2026-01-10T04:15:11.000Z',cash:.11,type:'interest',description:'Cash interest'})]);
});
test('existing daily references and CSV aliases do not post interest twice',()=>{
 const record=parse(text,[page()]).records[0];
 expect(merge([record],[record]).records).toHaveLength(1);
 const csv={...record,reference:'csv-native'};const result=merge([csv],[record]);expect(result.records).toHaveLength(1);expect(result.aliases.get(record.reference)).toBe('csv-native');
 expect(()=>merge([{...record,cash:.12}],[record])).toThrow('Conflicting');
});
test.each([
 [{currency:'USD'},'ledger_unsupported_activity'],[{market:'Buy Example'},'ledger_unsupported_activity'],[{when:'20 Jan 26 05:15:11 UTC+1'},'invalid_date'],[{amount:'-0.11'},'cash_conflict']
])('rejects unsupported or contradictory rows without partial records (%j)',(opts,reason)=>{
 try{parse(text,[page(opts)]);throw Error('Expected rejection');}catch(e){expect(e.igReason).toBe(reason);}
});
test('rejects repeated references and incomplete table columns',()=>{
 expect(()=>parse(text,[page(),page()])).toThrow();
 expect(()=>parse(text,[page().filter(i=>i.text!=='Currency')])).toThrow();
});
test('rejects an unanchored extra row instead of silently omitting it',()=>{
 expect(()=>parse(text,[[...page(),item('unparsed activity',10,100)]])).toThrow();
});

test('does not accept a second account or silently skip an unrecognised activity page',()=>{
 expect(()=>parse(text+' Account Id: OTHER',[page()])).toThrow('unknown_account');
 expect(()=>parse(text,[page(),[item('09Jan2605:15:11UTC+1',10,150)]])).toThrow('unsupported_layout');
});

test('bank withdrawal shares the CSV cash identity and keeps the broker sign',()=>{
 const record=parse(text,[page({market:'Bank Withdrawal',type:'WITH',direction:'-',amount:'-4,100.00'})]).records[0];
 expect(record).toMatchObject({type:'withdrawal',description:'Bank or card withdrawal',cash:-4100});
 expect(merge([{...record,reference:'export-withdrawal'}],[record]).records).toHaveLength(1);
});
