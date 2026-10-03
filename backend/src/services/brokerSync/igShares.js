// IG's share cash CSV posts settlement, not necessarily the execution date.
// Retain statement execution evidence privately alongside the settled history.
const {cents,london}=require('./igStatement');
const months={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
const fail=message=>{throw Error(`IG statement: ${message}. No records imported.`);};
const clean=s=>String(s).replace(/\s+/g,' ').trim().toUpperCase();
function descriptor(row) {
  const m=row.MarketName.match(/^(.+?)\s+CONS\s+([+-]?[\d.]+)@([\d.]+)\s+\S*?([0-9]+~[0-9]+)$/);
  if(!m)return null;
  return {name:m[1],quantity:Math.abs(Number(m[2])),price:Number(m[3]),dealCode:m[4]};
}
function statementTrades(text) {
  const start=text.indexOf('GBP ACCOUNT ACTIVITY');if(start<0)return [];
  const n='([+-]?[\\d,]+(?:\\.\\d+)?)';
  const pattern=new RegExp('(\\d{2})([A-Za-z]{3})(\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2})\\s+([0-9]+~[0-9]+)\\s+([\\s\\S]*?)\\s+([A-Z0-9]{4})\\s+([A-Z]{2}[A-Z0-9]{9}\\d)\\s+(Bought|Sold)\\s+GBP\\s+'+n+'\\s+'+n+'\\s+'+n+'(?:\\s+'+n+')?\\s+'+n+'\\s+'+n,'g');
  const trades=[];
  for(const m of text.slice(start).matchAll(pattern)) {
    const quantity=Number(m[10].replace(/,/g,'')),price=Number(m[11].replace(/,/g,'')),fees=cents(m[12])/100,cash=cents(m[14])/100;
    if(!months[m[2]]||quantity<=0||price<=0||fees<0||m[13]!=null||!((m[9]==='Bought'&&cash<0)||(m[9]==='Sold'&&cash>0)))fail('unsupported share execution currency or amount');
    const factors=[1,.01].filter(f=>Math.round(quantity*price*f*100)+(m[9]==='Bought'?cents(fees):-cents(fees))===Math.abs(cents(cash)));
    if(factors.length!==1)fail('share execution price units do not reconcile with its GBP cash');
    trades.push({dealCode:m[5],name:m[6].replace(/\s+/g,' ').trim().replace(/\s+(?:At Quote|At Market|Market|Limit|Stop(?: Limit)?)$/i,''),venue:m[7],isin:m[8],
      side:m[9]==='Bought'?'buy':'sell',quantity,reportedPrice:price,priceCurrency:factors[0]===.01?'GBX':'GBP',priceGBP:price*factors[0],fees,cash,
      time:london(`${m[1]}-${months[m[2]]}-20${m[3]} ${m[4]}`)});
  }
  const reported=(text.slice(start).match(/\b(?:Bought|Sold)\s+GBP\b/g)||[]).length;
  if(reported!==trades.length)fail('the complete share execution table could not be read');
  return trades;
}
function mergeTrades(old,newTrades) {
  const map=new Map();
  for(const t of [...old,...newTrades]) {
    const prior=map.get(t.dealCode);
    if(prior&&['isin','side','quantity','priceGBP','fees','cash','time'].some(k=>prior[k]!==t[k]))fail('an existing share execution changed');
    map.set(t.dealCode,t);
  }
  return [...map.values()];
}
function build(input,rows,records) {
  const known=input.shareSecurities||input.confirmation.holdings||[],legacy=input.shareLegacyHoldings||known;
  const evidence=input.shareTrades||[];
  const securities=[...known,...input.confirmation.holdings||[],...evidence.map(e=>({name:e.name,isin:e.isin,symbol:e.isin}))];
  const settlements=rows.map(row=>({row,d:descriptor(row)})).filter(x=>x.d);
  if(records.some(r=>r.type==='asset_adjustment'&&!settlements.some(s=>s.row.Reference===r.reference)))fail('an unrecognised share adjustment needs its execution history');
  const lots=[],trades=[],openingSignatures=[],usedEvidence=new Set();
  const recordMap=new Map(records.map(r=>[r.reference,r]));
  for(const {row,d} of settlements.sort((a,b)=>{
    const ea=evidence.find(e=>rowCodeMatches(a.row,e.dealCode)),eb=evidence.find(e=>rowCodeMatches(b.row,e.dealCode));
    return (ea?.time||a.row.DateUtc).localeCompare(eb?.time||b.row.DateUtc)||a.row.Reference.localeCompare(b.row.Reference);
  })) {
    if(!d.quantity||!d.price)fail('invalid share settlement quantity or price');
    const matches=evidence.filter(e=>rowCodeMatches(row,e.dealCode));if(matches.length>1)fail('ambiguous share execution');
    const e=matches[0],record=recordMap.get(row.Reference);
    const holding=securities.find(h=>e?h.isin===e.isin:clean(h.name)===clean(d.name));
    if(!holding)fail('a share settlement needs its ISIN from a trading statement');
    if(e&&(e.quantity!==d.quantity||e.reportedPrice!==d.price||cents(e.cash)!==cents(record.cash)||
      e.time>record.time||Date.parse(record.time)-Date.parse(e.time)>14*86400000||clean(e.name)!==clean(d.name)))fail('share execution differs from its cash settlement');
    const time=e?.time||record.time,fees=e?.fees||0,side=record.cash<0?'buy':'sell';
    if(e&&side!==e.side)fail('share settlement direction differs from execution');
    if(e)usedEvidence.add(e.dealCode);
    const oldHolding=legacy.find(h=>h.isin===holding.isin);
    // An existing statement-confirmed seed is retained when its contract note
    // was not supplied. New acquisitions always require execution evidence.
    if(!e&&!(side==='buy'&&oldHolding&&!lots.some(l=>l.isin===holding.isin)&&d.quantity===oldHolding.quantity&&Math.abs(cents(record.cash))===cents(oldHolding.cost)))
      fail('include the trading statement containing the new share purchase or sale');
    record.type='share_trade';record.description=side==='buy'?'Share purchase settlement':'Share sale settlement';record.shareFees=fees;
    if(side==='buy') {
      const legacyLot=oldHolding&&!lots.some(l=>l.isin===holding.isin)&&d.quantity===oldHolding.quantity&&-cents(record.cash)===cents(oldHolding.cost);
      const key=legacyLot?`holding:${holding.isin}`:`share-open:${row.Reference}`;
      const legacyTrade=legacyLot?{key,symbol:oldHolding.symbol,type:'stock',market:oldHolding.name,quantity:oldHolding.quantity,
        entryPrice:oldHolding.cost/oldHolding.quantity,exitPrice:null,pnl:null,fees:0,side:'long',entryTime:record.time,exitTime:null,holding:oldHolding}:null;
      lots.push({key,reference:row.Reference,isin:holding.isin,symbol:holding.symbol,market:holding.name,
        originalQuantity:d.quantity,remaining:d.quantity,cost:-record.cash,fees,time,price:e?.priceGBP,settlementTime:record.time,verified:!!e,legacyTrade});
    } else {
      let remaining=d.quantity;
      for(const lot of lots.filter(l=>l.isin===holding.isin&&l.remaining>0)) {
        const q=Math.min(remaining,lot.remaining);if(q<=0)break;
        const cost=lot.cost*q/lot.originalQuantity,proceeds=record.cash*q/d.quantity;
        trades.push({key:`share-close:${lot.reference}:${row.Reference}`,symbol:lot.symbol,type:'stock',market:lot.market,
          quantity:q,entryPrice:lot.cost/lot.originalQuantity,exitPrice:record.cash/d.quantity,pnl:proceeds-cost,
          fees:lot.fees*q/lot.originalQuantity+fees*q/d.quantity,side:'long',entryTime:lot.time,exitTime:time,
          openingKey:lot.reference,shareSettlement:{buy:lot.reference,sell:row.Reference}});
        lot.remaining=Math.max(0,lot.remaining-q);remaining-=q;
      }
      if(remaining>.000001)fail('a share sale exceeds the verified acquisition history');
    }
  }
  if(usedEvidence.size!==evidence.length)fail('a share execution is missing from the full cash settlement history');
  for(const lot of lots) {
    const signature={symbol:lot.symbol,entryTime:lot.time,entryPrice:lot.cost/lot.originalQuantity,side:'long',originalQuantity:lot.originalQuantity};
    openingSignatures.push({key:lot.reference,openKey:lot.key,signature,legacyTrade:lot.legacyTrade,executionVerified:lot.verified});
    if(lot.remaining<=.000001)continue;
    const h=input.confirmation.holdings.find(h=>h.isin===lot.isin);if(!h)fail('an open share lot is missing from the holdings statement');
    trades.push({key:lot.key,symbol:lot.symbol,type:'stock',market:lot.market,quantity:lot.remaining,entryPrice:lot.cost/lot.originalQuantity,
      exitPrice:null,pnl:null,fees:0,side:'long',entryTime:lot.time,exitTime:null,openingKey:lot.reference,openingSignature:signature,
      shareLot:{reference:lot.reference,executionVerified:lot.verified,reportedPriceGBP:lot.price,settlementTime:lot.settlementTime},legacyTrade:lot.legacyTrade,
      holding:{...h,quantity:lot.remaining,cost:lot.cost*lot.remaining/lot.originalQuantity,value:h.value*lot.remaining/h.quantity}});
  }
  for(const h of input.confirmation.holdings) {
    const open=lots.filter(l=>l.isin===h.isin&&l.remaining>0);
    const quantity=open.reduce((s,l)=>s+l.remaining,0);
    const grossCost=open.reduce((s,l)=>s+(l.cost-l.fees)*l.remaining/l.originalQuantity,0);
    if(Math.abs(quantity-h.quantity)>.000001||Math.abs(Math.round(grossCost*100)-cents(h.cost))>1)fail('share quantities or cost do not reconcile to holdings');
  }
  return {trades,openingSignatures};
}
function rowCodeMatches(row,code){return row.MarketName.endsWith(code);}
module.exports={descriptor,statementTrades,mergeTrades,build};
