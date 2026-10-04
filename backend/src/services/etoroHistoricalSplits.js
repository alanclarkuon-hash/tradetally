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
function historicalLotQuantity(trade,day,opened,closed,splits,marketSplits=[],{statementAuthority=false}={}) {
 const ids=new Set((trade.executions||[]).flatMap(e=>[e.etoro_position_id,e.etoro_parent_position_id]).filter(v=>v!=null).map(String));
 const allocated=splits.filter(s=>ids.has(s.positionId)&&s.symbol===trade.symbol.toUpperCase())
  .map(s=>({...s,date:effectiveDate(s,marketSplits)}))
  .filter(s=>s.date>opened&&(!closed||s.date<=closed));
 // After a split, the saved closure/current quantity is already on the right
 // basis. Allocation proof is needed only when undoing a later event.
 const expected=marketSplits.filter(s=>s.date>opened&&s.date>day&&(!closed||s.date<=closed));
 // Provider events alone cannot establish a split allocation to a position.
 if(!statementAuthority&&expected.some(s=>!allocated.some(a=>a.date===s.date&&Math.abs(a.ratio-s.ratio)<1e-8)))return null;
 // A split may be attached to both the child and original position in an
 // overlapping statement; each effective event changes units only once.
 const events=[...new Map(allocated.map(s=>[[s.date,s.ratio].join('|'),s])).values()];
 let quantity=Number(trade.quantity);
 for(const s of events)if(s.date>day)quantity/=s.ratio;
 return Number.isFinite(quantity)&&quantity>=0?quantity:null;
}
function statementLotMetadata(trades,records,splits) {
 const openings=new Map(),byId=new Map();
 const canonical=(symbol,currency)=>currency==='GBX'?symbol.toUpperCase().replace(/\.L$/,''):symbol.toUpperCase();
 for(const r of records) {
  if(r.sourceType!=='Open Position'||!r.positionId)continue;
  const match=/^([^/]+)\/([A-Z]{3})/.exec(r.details||'');if(!match)continue;
  const entry={...r,symbol:match[1].toUpperCase(),currency:match[2]};
  const key=[canonical(entry.symbol,entry.currency),String(r.time).slice(0,19)].join('|');
  const entries=openings.get(key)||new Map();entries.set(String(r.positionId),entry);openings.set(key,entries);byId.set(String(r.positionId),entry);
 }
 const result=new Map();
 for(const t of trades) {
  const ids=new Set((t.executions||[]).flatMap(e=>[e.etoro_position_id,e.etoro_parent_position_id]).filter(v=>v!=null).map(String));
  const direct=splits.filter(s=>ids.has(s.positionId));
  const original=[...ids].map(id=>byId.get(id)).filter(o=>o&&canonical(o.symbol,o.currency)===canonical(t.symbol,o.currency));
  const candidates=original.length?original:[...(openings.get([t.symbol.toUpperCase(),new Date(t.entry_time).toISOString().slice(0,19)].join('|'))?.values()||[])];
  const closed=t.exit_time?new Date(t.exit_time).toISOString().slice(0,10):null;
  const profiles=candidates.map(o=>splits.filter(s=>s.positionId===o.positionId&&(!closed||s.date<=closed)));
  const signature=events=>JSON.stringify(events.map(s=>[s.symbol,s.date,s.ratio]).sort());
  // Unique openings or unanimous candidate allocations establish a link.
  // A symbol alone, or conflicting simultaneous openings, never does.
  const unanimous=profiles.length&&profiles.every(p=>signature(p)===signature(profiles[0]));
  let chosen=unanimous?profiles[0]:null;
  const leverage=Number(t.executions?.find(e=>e.type==='entry')?.etoro_leverage||1);
  const ratioFor=o=>Math.abs(Number(o.amount))*leverage/Number(o.units)/Number(t.entry_price);
  const near=(a,b)=>Number.isFinite(a)&&Math.abs(a/b-1)<.01;
  // Partial closures may lack a parent ID. Their adjusted entry cost must
  // independently agree with an opening's recorded split profile.
  const verified=profiles.filter((p,i)=>p.length&&near(ratioFor(candidates[i]),p.reduce((r,s)=>r*s.ratio,1)));
  if(!chosen&&verified.length&&verified.every(p=>signature(p)===signature(verified[0])))chosen=verified[0];
  // A 1:1 corporate-action label can accompany a real unit conversion.
  // Prefer the statement's opening/closing units when the invested cost
  // independently confirms that conversion; never invent a provider ratio.
  if(original.length===1&&chosen?.length===1&&chosen[0].ratio===1) {
   const ratio=Number(t.quantity)/Number(original[0].units);
   if(ratio>0&&near(ratioFor(original[0]),ratio))chosen=[{...chosen[0],ratio}];
  }
  const inherited=chosen&&ids.size?chosen.map(s=>({...s,symbol:t.symbol.toUpperCase(),positionId:[...ids][0]})):[];
  const currencies=new Set(candidates.map(o=>o.currency));
  const symbols=new Set(candidates.map(o=>o.symbol));
  const currency=currencies.size===1?[...currencies][0]:null;
  let marketSymbol=symbols.size===1?[...symbols][0]:null;
  if(currency==='GBX'&&marketSymbol&&!marketSymbol.includes('.'))marketSymbol+='.L';
  const unchanged=candidates.length&&candidates.every(o=>near(ratioFor(o),1));
  const authority=original.length>0||!!chosen?.length||unchanged;
  // A mapped statement profile replaces the provider or differently named
  // broker profile, rather than applying both to the same lot.
  result.set(t,{splits:statementSplitsLike(inherited.length?inherited:direct),currency,marketSymbol,statementAuthority:authority});
 }
 return result;
}
function statementSplitsLike(splits){return [...new Map(splits.map(s=>[[s.positionId,s.symbol,s.date,s.ratio].join('|'),s])).values()];}
module.exports={statementSplits,historicalLotQuantity,statementLotMetadata};
