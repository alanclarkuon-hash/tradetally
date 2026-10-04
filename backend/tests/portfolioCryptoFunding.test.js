const {cryptoFundingEvents}=require('../src/services/portfolioCryptoFunding');
const accounts=[{account_identifier:'k',account_name:'Kraken'},{account_identifier:'o',account_name:'OKX'}];
const time=Date.parse('2026-01-02T12:00:00Z');
const snapshots=[{broker_type:'kraken',account_identifier:'k',payload:{ledger:{deposit:{type:'deposit',asset:'USDT',amount:'100',fee:'1',time:time/1000},withdrawal:{type:'withdrawal',asset:'USDT',amount:'-50',fee:'2',time:time/1000}},valuation:{rates:{USDT:{'2026-01-02':.99}}}}},
 {broker_type:'okx',account_identifier:'o',payload:{deposits:[{state:'2',depId:'receipt',ccy:'USDT',amt:'50',ts:String(time+86400000)}],rates:{'2026-01-03':1.01}}}];
const pair={source_broker:'kraken',source_account:'k',source_reference:'withdrawal',destination_broker:'okx',destination_account:'o',destination_reference:'receipt',asset:'USDT',quantity:'50'};
const fx=()=>({rate:.8,sourceDate:'2026-01-02'});
const run=(selected=accounts,pairs=[pair],records=snapshots,prices=new Map(),convert=fx,range=null)=>cryptoFundingEvents(records,selected,pairs,prices,convert,'GBP',range);
test('excludes both internally matched legs across dates, retaining external funding gross of fees',()=>{
 expect(run()).toEqual([expect.objectContaining({date:'2026-01-02',quantity:100,amount:79.2,asset:'USDT',crypto:true})]);
});
test('one selected account treats its boundary transfer as funding, not profit',()=>{
 expect(run([accounts[0]]).map(e=>e.amount)).toEqual([79.2,-39.6]);
 expect(run([accounts[1]])[0]).toMatchObject({quantity:50,amount:40.4});
});
test('external withdrawals exclude withdrawal fees, Earn transfers and unfinished deposits',()=>{
 const records=[{broker_type:'kraken',account_identifier:'k',payload:{ledger:{x:{type:'withdrawal',asset:'XXBT',amount:'-2',fee:'0.1',time:time/1000},earn:{type:'transfer',asset:'XXBT',amount:'-5',fee:'0',time:time/1000}},valuation:{rates:{BTC:{'2026-01-02':10}}}}},
 {broker_type:'okx',account_identifier:'o',payload:{deposits:[{state:'1',depId:'pending',ccy:'BTC',amt:'5',ts:String(time)}]}}];
 expect(run(accounts,[],records)).toEqual([expect.objectContaining({quantity:-2,amount:-16})]);
});
test('uses exact cached closes, never today prices, previous day prices or assumed stablecoin pegs',()=>{
 const records=[{broker_type:'okx',account_identifier:'o',payload:{deposits:[{state:'2',depId:'done',ccy:'SUI',amt:'3',ts:String(time)}]}}];
 expect(run(accounts,[],records)[0].amount).toBeNull();
 expect(run(accounts,[],records,new Map([['SUI-USD',{currency:'USD',prices:[{date:'2026-01-01',close:10}]}]]))[0].amount).toBeNull();
 expect(run(accounts,[],records,new Map([['SUI-USD',{currency:'USD',prices:[{date:'2026-01-02',close:10}]}]]))[0].amount).toBe(24);
 expect(run(accounts,[],records,new Map(),()=>({rate:null}))[0].amount).toBeNull();
});
test('applies range and account selection and does not double count or mutate records',()=>{
 const before=JSON.stringify(snapshots);
 expect(run(accounts,[pair],snapshots,new Map(),fx,{start_date:'2026-01-03',end_date:'2026-01-04'})).toEqual([]);
 expect(run([])).toEqual([]);
 expect(JSON.stringify(snapshots)).toBe(before);
});

