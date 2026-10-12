// Account capital is independent of a rounded chart quotation.
function executions(trade){try{const rows=typeof trade.executions==='string'?JSON.parse(trade.executions):trade.executions;return Array.isArray(rows)?rows:[];}catch{return [];}}
function entryCapital(trade){
 if(trade.broker!=='etoro')return null;
 const entries=executions(trade).filter(e=>e.action===(trade.side==='short'?'sell':'buy'));
 if(entries.length!==1)return null;
 const e=entries[0],capital=Number(e.etoro_invested_capital);
 if(e.etoro_capital_currency!=='USD'||e.etoro_invested_capital==null||!Number.isFinite(capital)||capital<0||!Number.isFinite(Number(trade.quantity))||Number(trade.quantity)<=0||Math.abs(Number(e.quantity)-Number(trade.quantity))>1e-8)return null;
 return capital;
}
function recoverCashCapital(trade,records){
 const es=executions(trade),e=es[0];
 if(trade.broker!=='etoro'||!e?.etoro_statement_source||!trade.exit_time||trade.pnl==null||!e.etoro_position_id)return null;
 const matches=records.filter(r=>r.sourceType==='Position closed'&&String(r.positionId)===String(e.etoro_position_id)&&Math.abs(Date.parse(r.time)-Date.parse(trade.exit_time))<=15000);
 if(matches.length!==1||matches[0].amount==null)return null;
 const capital=Number(matches[0].amount)-Number(trade.pnl);
 if(!Number.isFinite(capital)||capital<0)return null;
 const rounded=Math.round(capital*100)/100;
 // Short and leveraged statement rows use margin capital. Independently
 // corroborate the cash-derived amount against the imported margin return.
 if(trade.side==='short'||Number(e.etoro_leverage||1)!==1){
  if(!(rounded>0)||trade.pnl_percent==null||Math.abs(Number(trade.pnl)/rounded*100-Number(trade.pnl_percent))>1e-6)return null;
 }
 return rounded;
}
module.exports={entryCapital,recoverCashCapital};
