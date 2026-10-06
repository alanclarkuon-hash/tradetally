// Read-only end-of-day holdings, using the same saved ledgers, corporate
// actions and unadjusted dated closes as portfolio value reconstruction.
const db=require('../config/database');
const {historySymbol,historySplits,historicalMarketSymbol}=require('./portfolioCorporateActions');
const {normalizeTicker,currentSymbol}=require('./brokerSync/trading212Instruments');
const {assetCode,decimal,format}=require('./brokerSync/krakenReconcile');
const {statementSplits,statementLotMetadata,historicalLotQuantity}=require('./etoroHistoricalSplits');
const {cfdEquity}=require('./etoroHistoricalCfd');
const {normaliseMinorUnit}=require('../utils/quoteCurrency');
const {previousDay}=require('../utils/heatmapPeriod');
const day=v=>new Date(v).toISOString().slice(0,10);
const FIAT=new Set(['USD','GBP','EUR','CAD','AUD','JPY','CHF']);

// FIFO leaves only units owned at the end date. Splits change units and unit
// cost together; sales must not leave closed lots in the range's P&L basis.
function remainingLots(events,end) {
  const lots=new Map();
  for(const e of [...events].sort((a,b)=>a.date.localeCompare(b.date)||(a.split?-1:b.split?1:0)||String(a.time||'').localeCompare(String(b.time||'')))) {
    if(e.date>end)continue;
    const rows=lots.get(e.symbol)||[];
    if(e.split){for(const l of rows){l.quantity*=e.split;if(l.price!=null)l.price/=e.split;}}
    else if(e.quantity>0)rows.push({...e,acquired:e.date});
    else {let remove=-e.quantity;while(remove>1e-9&&rows.length){const q=Math.min(remove,rows[0].quantity);rows[0].quantity-=q;remove-=q;if(rows[0].quantity<1e-9)rows.shift();}}
    lots.set(e.symbol,rows);
  }
  return lots;
}

async function getHistoricalHoldings(userId,accounts,range,currency='USD') {
  const baselineDate=previousDay(range.start_date);
  const {historicalPrice,migrationPriceAliases}=require('./portfolioReconstructionService');
  const [prices,fxRows,snapshots,reports,portfolios,trades]=await Promise.all([
    db.query('SELECT symbol,payload FROM portfolio_reconstruction_prices'),
    db.query("SELECT rate_date,rates FROM fx_daily_rates WHERE base_code='USD' ORDER BY rate_date"),
    db.query('SELECT broker_type,account_identifier,payload FROM broker_import_snapshots WHERE user_id=$1',[userId]),
    db.query('SELECT account_id,broker_type,records,updated_at FROM broker_cash_reports WHERE user_id=$1 ORDER BY updated_at',[userId]),
    db.query('SELECT account_identifier,positions FROM broker_portfolio_snapshots WHERE user_id=$1',[userId]),
    db.query('SELECT * FROM trades WHERE user_id=$1',[userId])
  ]);
  const market=new Map(prices.rows.map(r=>[r.symbol,r.payload]));
  const fx=(currency,date)=>{
    if(currency==='USD')return 1;
    const row=fxRows.rows.filter(r=>day(r.rate_date)<=date).at(-1);
    return row&&Date.parse(date)-Date.parse(day(row.rate_date))<=7*86400000&&Number(row.rates[currency])>0?1/Number(row.rates[currency]):null;
  };
  const quote=(symbol,date)=>{
    const series=market.get(symbol),price=historicalPrice(series,date,symbol.endsWith('-USD'));
    const rate=series?fx(series.currency,date):null;
    return price>0&&rate>0?price*rate:null;
  };
  const publicRates=snapshots.rows.find(r=>r.broker_type==='kraken')?.payload?.valuation?.rates||{};
  const positions=[],warnings=[];
  function add(symbol,type,account,quantity,value,basis,issues=[],name=null) {
    if(!(quantity>1e-8)||FIAT.has(symbol))return;
    const missing=value==null;
    if(missing)issues.push('Missing historical price; value estimated at zero');
    positions.push({symbol,name,instrumentType:type,totalShares:quantity,currentValue:value??0,
      totalCostBasis:basis??0,currentPrice:value==null?null:value/quantity,
      priceAsOf:range.end_date,accountIdentifiers:[account.account_identifier],historicalWarnings:issues,
      periodResult:{pnl:!missing&&basis>0?value-basis:null,percent:!missing&&basis>0?(value-basis)/basis*100:null,basis}});
  }
  for(const account of accounts) {
    if(account.initial_balance_date&&day(account.initial_balance_date)>range.end_date)continue;
    const identifier=account.account_identifier;
    const accountTrades=trades.rows.filter(t=>t.account_identifier===identifier&&t.broker===account.broker);
    const payload=snapshots.rows.find(r=>r.account_identifier===identifier&&r.broker_type===account.broker)?.payload;
    const ownReports=reports.rows.filter(r=>r.account_id===account.id&&r.broker_type===account.broker);
    if(['kraken','okx'].includes(account.broker)) {
      const rows=account.broker==='kraken'?Object.values(payload?.ledger||{}).map(l=>({date:day(Number(l.time)*1000),time:Number(l.time)*1000,symbol:assetCode(l.asset),quantity:Number(format(decimal(l.amount)-decimal(l.fee||'0'))),price:null})):
        (payload?.bills||[]).map(l=>({date:day(Number(l.ts)),time:Number(l.ts),symbol:l.ccy,quantity:Number(l.balChg),price:null}));
      if(!payload)warnings.push(`${account.account_name}: no saved native ledger`);
      const migrations=migrationPriceAliases(payload?.ledger);
      const price=(s,d)=>Number(payload?.valuation?.rates?.[s]?.[d])||Number(publicRates[s]?.[d])||(s==='USDT'?Number(payload?.rates?.[d]):0)||quote(s+'-USD',d)||(migrations.has(`${s}:${d}`)?quote(migrations.get(`${s}:${d}`)+'-USD',d):null);
      // Ledger pairs are internal wallet movements, so replay net changes per
      // asset and timestamp. Moving into Earn must not reset acquisition dates.
      const net=new Map();
      for(const r of rows){const key=r.symbol+'|'+r.time;const old=net.get(key);if(old)old.quantity+=r.quantity;else net.set(key,{...r});}
      const lots=remainingLots([...net.values()],range.end_date);
      for(const [s,held] of lots) {
        const q=held.reduce((n,l)=>n+l.quantity,0),p=price(s,range.end_date);
        let basis=0,known=true;
        const tradeLots=accountTrades.filter(t=>t.symbol===s&&t.side==='long'&&day(t.entry_time||t.trade_date)<=range.end_date&&(!t.exit_time||day(t.exit_time)>range.end_date));
        const tradeQuantity=tradeLots.reduce((n,t)=>n+Number(t.quantity),0);
        if(Math.abs(tradeQuantity-q)<Math.max(1e-8,q*1e-7)) {
          for(const t of tradeLots) {
            const acquired=day(t.entry_time||t.trade_date),start=acquired>=range.start_date?Number(t.entry_price):price(s,baselineDate);
            if(!(start>0)){known=false;break;}basis+=Number(t.quantity)*start;
          }
        }else {
        for(const l of held) {
          if(l.acquired>=range.start_date){known=false;break;} // Transfers/rewards are not purchases with an established cost.
          const start=price(s,baselineDate);if(!(start>0)){known=false;break;}basis+=l.quantity*start;
        }
        }
        add(s,'crypto',account,q,p>0?q*p:null,known?basis:null,known?[]:['Period basis unavailable for ledger acquisitions or transfers']);
      }
    }else if(account.broker==='trading212') {
      const report=ownReports.at(-1);
      const portfolio=portfolios.rows.find(r=>r.account_identifier===identifier);
      const mapping=new Map((portfolio?.positions||[]).map(p=>[p.instrument.ticker,currentSymbol(p.instrument)]));
      const fills=(report?.records||[]).map(r=>{
        const symbol=historySymbol(mapping.get(r.symbol)||normalizeTicker(r.symbol),r.date);
        const q=Number(r.quantity),rate=fx(account.currency,r.date);
        return {date:r.date,time:r.time,symbol,quantity:q*(r.side==='BUY'?1:-1),price:rate>0&&q>0?Math.abs(Number(r.amount))*rate/q:null};
      });
      const actions=(await db.query("SELECT event_date,metadata FROM broker_cash_events WHERE user_id=$1 AND account_id=$2 AND broker_type='trading212' AND event_type='corporate_action' AND description='Deposit: rights issue executed (NG)'",[userId,account.id])).rows;
      for(const r of actions)if(Number(r.metadata?.statement_annotation?.apiAmount)>0)fills.push({symbol:'NG.L',date:day(r.event_date),quantity:Number(r.metadata.statement_annotation.apiAmount)/6.45,price:6.45*fx('GBP',day(r.event_date))});
      const splits=[...new Set(fills.map(f=>f.symbol))].flatMap(s=>historySplits(s,market.get(s)?.splits||[]).map(e=>({symbol:s,date:e.date,split:e.ratio})));
      const lots=remainingLots([...fills,...splits],range.end_date);
      if(!report)warnings.push(`${account.account_name}: no saved order history`);
      for(const [s,held] of lots) {
        const series=market.get(s),q=held.reduce((n,l)=>n+l.quantity,0),p=quote(s,range.end_date);
        let basis=0,known=true;
        for(const l of held) {
          const later=historySplits(s,series?.splits||[]).filter(x=>x.date>baselineDate&&x.date<=range.end_date).reduce((n,x)=>n*x.ratio,1);
          const start=l.acquired>=range.start_date?l.price:quote(s,baselineDate)/later;
          if(!(start>0)){known=false;break;}basis+=l.quantity*start;
        }
        add(s,'stock',account,q,p>0?q*p:null,known?basis:null);
      }
    }else {
      const records=ownReports.flatMap(r=>r.records||[]),metadata=account.broker==='etoro'?statementLotMetadata(accountTrades,records,statementSplits(records)):new Map();
      for(const t of accountTrades) {
        const opened=day(t.entry_time||t.trade_date),closed=t.exit_time?day(t.exit_time):null;
        if(opened>range.end_date||(closed&&closed<=range.end_date))continue;
        const meta=metadata.get(t),s=account.broker==='etoro'&&t.instrument_type!=='crypto'&&meta?.marketSymbol?historySymbol(meta.marketSymbol,opened):historicalMarketSymbol(t.symbol,t.instrument_type,opened);
        const series=market.get(s);
        const units=d=>account.broker==='etoro'?historicalLotQuantity(t,d,opened,closed,meta?.splits||[],series?.splits||[],meta):
          Number(t.quantity)/(series?.splits||[]).filter(x=>x.date>d&&x.date>opened&&(!closed||x.date<=closed)).reduce((n,x)=>n*x.ratio,1);
        const q=units(range.end_date),startDate=opened>=range.start_date?opened:baselineDate;
        if(q==null){warnings.push(`${t.symbol}: historic split allocation unavailable`);continue;}
        const p=quote(s,range.end_date),startPrice=quote(s,startDate),startQ=units(startDate);
        let value=p>0?q*p:null,basis=startPrice>0&&startQ!=null?startQ*startPrice:null;
        if(t.instrument_type==='cfd'&&account.broker==='etoro') {
          const unit=normaliseMinorUnit(meta?.currency||series?.currency);
          const equity=d=>unit&&series&&unit.code===series.currency?cfdEquity(t,units(d),historicalPrice(series,d),fx(series.currency,d),{nativeDivisor:unit.divisor}):null;
          value=equity(range.end_date);basis=equity(startDate);
        }else if(!['stock','crypto'].includes(t.instrument_type)||t.side!=='long') {value=null;basis=null;}
        // Acquisition basis uses recorded execution cost, retaining a split-
        // adjusted entry price. Opening-day closing prices are not trade costs.
        if(opened>=range.start_date&&['stock','crypto'].includes(t.instrument_type)) {
          basis=Number(t.entry_price)*Number(t.quantity); // TradeTally stores execution costs in USD.
        }
        const symbol=t.instrument_type==='crypto'?s.replace(/-USD$/,''):s;
        add(symbol,t.instrument_type,account,q,value,basis,[],t.name||null);
      }
    }
  }
  // Group only after account-specific replay: a sale in one account cannot
  // consume another account's units or erase its acquisition basis.
  const combined=new Map();
  for(const p of positions) {
    const key=p.instrumentType+'|'+p.symbol,existing=combined.get(key);
    if(!existing){combined.set(key,p);continue;}
    existing.totalShares+=p.totalShares;existing.currentValue+=p.currentValue;existing.totalCostBasis+=p.totalCostBasis;
    existing.accountIdentifiers=[...new Set([...existing.accountIdentifiers,...p.accountIdentifiers])];
    existing.historicalWarnings=[...new Set([...existing.historicalWarnings,...p.historicalWarnings])];
    const known=existing.periodResult.pnl!=null&&p.periodResult.pnl!=null,basis=existing.periodResult.basis+p.periodResult.basis;
    existing.periodResult={pnl:known?existing.periodResult.pnl+p.periodResult.pnl:null,percent:known&&basis>0?(existing.currentValue-basis)/basis*100:null,basis};
  }
  return {positions:[...combined.values()],warnings,displayRates:{USD:currency==='USD'?1:(fx('GBP',range.end_date)>0?1/fx('GBP',range.end_date):null)}};
}
module.exports={getHistoricalHoldings,remainingLots};
