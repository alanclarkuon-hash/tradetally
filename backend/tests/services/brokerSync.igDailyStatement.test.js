const {parse,dateFromName}=require('../../src/services/brokerSync/igDailyStatement');
const base={kind:'share_dealing',statementMask:'S***1',statementLabel:'GIA',confirmation:{holdings:[{isin:'GB0000000001',symbol:'SYN',name:'Synthetic',quantity:1,cost:1}]}};
const text=`STATEMENT\n06 Oct 2026\nAccount No. S***1\nAccount Name GIA\nACCOUNT SUMMARY IN GBP\nValue of GBP assets 2.00 2.00\nCash balance GBP 101.50\nTotal account value 103.50\nHOLDINGS GBP\nSynthetic GB0000000001 1 1.00 2.00 2.00 1.00 100.00\nGBP ACCOUNT ACTIVITY\nBALANCE\nBROUGHT\nFORWARD\n100.00\n05Oct26\n05:15:38\nCS1234\n5678\nCash Interest Paid\nTo Client - Oct26\nDEPO GBP 1.5 101.50\nBalance 101.50\nIG is a trading name`;
test('uses reporting date, validates the following print day and reconciles interest',()=>{
 const p=parse(text,'2026-10-05',base);expect(p).toMatchObject({date:'2026-10-05',cash:101.5,holdings:2,total:103.5,activitySupported:true});
 expect(p.records).toEqual([expect.objectContaining({reference:'email:CS12345678',type:'interest',cash:1.5,time:'2026-10-05T04:15:38.000Z'})]);
 expect(p.positions[0].asOf).toBe('2026-10-05T21:00:00.000Z');
});
test('handles Friday reporting day printed Monday',()=>{expect(parse(text.replace('06 Oct','05 Oct').replace('05Oct26','02Oct26'),'2026-10-02',base).date).toBe('2026-10-02');});
test.each([
 ['equity',text.replace('103.50','104.50'),'2026-10-05'],
 ['cash',text.replace('100.00\n05Oct','99.00\n05Oct'),'2026-10-05'],
 ['identity',text.replace('S***1','S***2'),'2026-10-05'],
 ['date',text,'2026-02-30'],
 ['print lag',text,'2026-09-01'],
 ['unknown holding',text.replace('GB0000000001','GB0000000002'),'2026-10-05'],
 ['missing holding',text.replace('Synthetic GB0000000001 1 1.00 2.00 2.00 1.00 100.00',''),'2026-10-05']
])('rejects %s conflicts',(_,input,date)=>expect(()=>parse(input,date,base)).toThrow());
test('recognises original and renamed download filenames',()=>{
 expect(dateFromName('5 October 2026 Share dealing Statement (1).pdf')).toBe('2026-10-05');
 expect(dateFromName('a'.repeat(64)+' - 2 October 2026 Share dealing Statement.pdf')).toBe('2026-10-02');
});
test('unsupported execution rows are staged for review, not silently ignored',()=>{
 const changed=text.replace('Cash Interest Paid\nTo Client - Oct26\nDEPO GBP 1.5 101.50','Synthetic Bought GBP 1 1 0 -1 99');
 expect(parse(changed,'2026-10-05',base).activitySupported).toBe(false);
});
