// Statement quantities for closed lots are expressed in units at closure;
// open lots use current units. Undo only later splits allocated to that lot.
function statementSplits(records) {
 const unique=new Map();
 for(const r of records) {
  if(r.sourceType!=='corp action: Split')continue;
  const match=/^([^/]+)\/[A-Z]{3}\s+(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(r.details||'');
  if(!match||!r.positionId)continue;
  const ratio=Number(match[2])/Number(match[3]);
  if(!(ratio>0))continue;
  const split={positionId:String(r.positionId),symbol:match[1].toUpperCase(),date:r.date,ratio};
  unique.set([split.positionId,split.symbol,split.date,ratio].join('|'),split);
 }
 return [...unique.values()];
}
function effectiveDate(split,marketSplits) {
 const nearby=marketSplits.filter(s=>Math.abs(s.ratio-split.ratio)<1e-8&&
  Math.abs(Date.parse(s.date)-Date.parse(split.date))<=3*86400000);
 if(nearby.length===1)return nearby[0].date;
 // Statements can record a weekend allocation before Monday's trading.
 const day=new Date(split.date+'T00:00:00Z');
 while([0,6].includes(day.getUTCDay()))day.setUTCDate(day.getUTCDate()+1);
 return day.toISOString().slice(0,10);
}
function historicalLotQuantity(trade,day,opened,closed,splits,marketSplits=[]) {
 const ids=new Set((trade.executions||[]).flatMap(e=>[e.etoro_position_id,e.etoro_parent_position_id]).filter(v=>v!=null).map(String));
 const allocated=splits.filter(s=>ids.has(s.positionId)&&s.symbol===trade.symbol.toUpperCase())
  .map(s=>({...s,date:effectiveDate(s,marketSplits)}))
  .filter(s=>s.date>opened&&(!closed||s.date<=closed));
 // After a split, the saved closure/current quantity is already on the right
 // basis. Allocation proof is needed only when undoing a later event.
 const expected=marketSplits.filter(s=>s.date>opened&&s.date>day&&(!closed||s.date<=closed));
 // Provider events alone cannot establish a split allocation to a position.
 if(expected.some(s=>!allocated.some(a=>a.date===s.date&&Math.abs(a.ratio-s.ratio)<1e-8)))return null;
 // A split may be attached to both the child and original position in an
 // overlapping statement; each effective event changes units only once.
 const events=[...new Map(allocated.map(s=>[[s.date,s.ratio].join('|'),s])).values()];
 let quantity=Number(trade.quantity);
 for(const s of events)if(s.date>day)quantity/=s.ratio;
 return Number.isFinite(quantity)&&quantity>=0?quantity:null;
}
module.exports={statementSplits,historicalLotQuantity};
