// Freshness uses source time, never the time a cached quote was read.
const MAX_AGE_MS = 15 * 60 * 1000;
function timestamp(quote) {
  const value = quote?.asOf ? Date.parse(quote.asOf) : Number(quote?.t) > 0 ? Number(quote.t) * 1000 : NaN;
  return Number.isFinite(value) && value <= Date.now() + 60000 ? value : null;
}
function fresh(quote) { const time=timestamp(quote); return time!==null && Date.now()-time<=MAX_AGE_MS; }
function newer(candidate, current) {
  if (!candidate || !(Number(candidate.c)>0) || !Number.isFinite(Number(candidate.c))) return current;
  if (!current) return candidate;
  const a=timestamp(candidate), b=timestamp(current);
  return a!==null && (b===null || a>b) ? candidate : current;
}
module.exports={timestamp,fresh,newer,MAX_AGE_MS};
