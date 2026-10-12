// Reconstruct internal transfer shipments before importing either account.
// Every account is verified against the same OKX main UID by the service.
const day=ts=>new Date(Number(ts)).toISOString().slice(0,10);
function transferBasis(accounts) {
  if(new Set(accounts.map(a=>a.id)).size!==accounts.length)throw Error('Duplicate OKX account in transfer reconciliation');
  const incoming=new Map(accounts.map(a=>[a.id,new Map()]));
  const outgoing=accounts.flatMap(a=>a.payload.bills.filter(b=>b.type==='1'&&b.subType==='12').map(b=>({account:a,bill:b})));
  const receipts=accounts.flatMap(a=>a.payload.bills.filter(b=>b.type==='1'&&b.subType==='11').map(b=>({account:a,bill:b})));
  const pairs=new Map(),used=new Set();
  for(const out of outgoing) {
    const matches=receipts.filter(r=>r.account.id!==out.account.id&&r.bill.ccy===out.bill.ccy&&
      Math.abs(Number(r.bill.balChg)+Number(out.bill.balChg))<1e-10&&Math.abs(Number(r.bill.ts)-Number(out.bill.ts))<=10000);
    if(matches.length>1)throw Error('Ambiguous OKX internal transfer; previous reports were preserved.');
    if(!matches.length)continue;
    const receipt=matches[0],key=`${receipt.account.id}:${receipt.bill.billId}`;
    const senders=outgoing.filter(s=>s.account.id!==receipt.account.id&&s.bill.ccy===receipt.bill.ccy&&
      Math.abs(Number(s.bill.balChg)+Number(receipt.bill.balChg))<1e-10&&Math.abs(Number(s.bill.ts)-Number(receipt.bill.ts))<=10000);
    if(senders.length!==1||used.has(key))throw Error('Ambiguous OKX internal transfer; previous reports were preserved.');
    used.add(key);pairs.set(`${out.account.id}:${out.bill.billId}`,receipt);
  }
  const ledgers=new Map(accounts.map(a=>[a.id,new Map()]));const events=[];
  for(const a of accounts) {
    for(const f of a.payload.fills)events.push({account:a,time:Number(f.fillTime),fill:f,priority:2});
    for(const b of a.payload.bills) {
      if(b.type==='1'&&b.subType==='12')events.push({account:a,time:Number(b.ts),bill:b,priority:0});
      else if(b.ccy==='USDT'&&!(b.type==='1'&&used.has(`${a.id}:${b.billId}`)))events.push({account:a,time:Number(b.ts),bill:b,priority:3});
      else if(b.type==='1'&&b.subType==='11'&&!used.has(`${a.id}:${b.billId}`))throw Error('OKX incoming coin transfer is missing verified acquisition history');
    }
  }
  // A paired receipt is processed atomically with its sender, even when broker clocks differ.
  function consume(account,asset,amount) {
    const lots=ledgers.get(account).get(asset)||[],shipment=[];let remaining=amount;
    while(remaining>1e-12&&lots.length) {
      const lot=lots[0],quantity=Math.min(remaining,lot.quantity);shipment.push({...lot,quantity});
      lot.quantity-=quantity;remaining-=quantity;if(lot.quantity<1e-12)lots.shift();
    }
    if(remaining>1e-8)throw Error('OKX transfer or sale is missing its acquisition history');
    return shipment;
  }
  function add(account,asset,shipments) {
    const ledger=ledgers.get(account),lots=ledger.get(asset)||[];ledger.set(asset,lots);
    for(const shipment of shipments) {
      const old=lots.find(l=>l.id===shipment.id&&l.origin===shipment.origin);
      if(old)old.quantity+=shipment.quantity;else lots.push({...shipment});
    }
    lots.sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
  }
  for(const e of events.sort((a,b)=>a.time-b.time||a.priority-b.priority||String(a.fill?.billId||a.bill.billId).localeCompare(String(b.fill?.billId||b.bill.billId)))) {
    const a=e.account,fx=a.payload.rates[day(e.time)];
    if(e.fill) {
      const f=e.fill,[base,quote]=f.instId.split('-');
      if(f.instType!=='SPOT'||quote!=='USDT'||!['buy','sell'].includes(f.side)||![base,quote].includes(f.feeCcy))throw Error('Unsupported OKX spot instrument or fee asset');
      const size=Number(f.fillSz),price=Number(f.fillPx),fee=Number(f.fee);
      if(!(size>0&&price>0&&fx>0&&Number.isFinite(fee)))throw Error('Incomplete OKX acquisition or historical FX');
      if(f.side==='buy') {
        const quantity=size+(f.feeCcy===base?fee:0),cost=size*price-(f.feeCcy===quote?fee:0);
        if(!(quantity>0&&cost>0))throw Error('Invalid fee-adjusted OKX acquisition');
        add(a.id,base,[{id:String(f.billId),origin:a.id,quantity,unitCost:cost/quantity,fx,time:new Date(e.time).toISOString(),fill:f}]);
      }else consume(a.id,base,size-(f.feeCcy===base?fee:0));
    }else {
      const b=e.bill,amount=Number(b.balChg);
      if(!Number.isFinite(amount))throw Error('Incomplete OKX asset movement');
      if(amount<0) {
        const shipment=consume(a.id,b.ccy,-amount),receipt=pairs.get(`${a.id}:${b.billId}`);
        if(receipt) {
          add(receipt.account.id,b.ccy,shipment);
          incoming.get(receipt.account.id).set(String(receipt.bill.billId),{lots:shipment,time:e.time});
        }
      }else if(amount>0) {
        if(!(fx>0))throw Error('Missing historical USDT/USD index rate');
        add(a.id,'USDT',[{id:String(b.billId),origin:a.id,quantity:amount,unitCost:1,fx,time:new Date(e.time).toISOString()}]);
      }
    }
  }
  return incoming;
}
module.exports={transferBasis};
