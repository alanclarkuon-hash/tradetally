// The API ticker is a permanent broker key, not necessarily the current
// exchange ticker. Never change it in execution history or reconciliation.
function normalizeTicker(ticker) {
  const raw = String(ticker || '').trim();
  const london = raw.match(/^(.+)l_EQ$/) || raw.match(/^(.+)_GB_EQ$/i);
  if (london) return `${london[1].toUpperCase()}.L`;
  return raw.replace(/_US_EQ$/i, '').toUpperCase();
}

function currentSymbol(instrument = {}) {
  const ticker = String(instrument.ticker || '');
  const shortName = String(instrument.shortName || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.^-]{0,29}$/.test(shortName)) return normalizeTicker(ticker);
  if (/l_EQ$/.test(ticker) || /_GB_EQ$/i.test(ticker))
    return shortName.endsWith('.L') ? shortName : `${shortName}.L`;
  if (/_US_EQ$/i.test(ticker)) return shortName;
  // Unrecognised listings need an exchange mapping before we can safely use
  // their short ticker with a market-data provider.
  return normalizeTicker(ticker);
}

function enrichPositions(positions, instruments) {
  if (!Array.isArray(instruments)) throw Error('Invalid Trading 212 instrument catalogue');
  const catalogue = new Map();
  for (const instrument of instruments) {
    if (!instrument?.ticker) continue;
    if (catalogue.has(instrument.ticker)) throw Error('Ambiguous Trading 212 instrument catalogue');
    catalogue.set(instrument.ticker, instrument);
  }
  return positions.map(position => {
    const original = position.instrument || {};
    const latest = catalogue.get(original.ticker);
    if (!latest || (original.isin && latest.isin && original.isin !== latest.isin)) return position;
    return {...position, instrument: {...original,
      ...(latest.name ? {name: latest.name} : {}),
      ...(latest.shortName ? {shortName: latest.shortName} : {})}};
  });
}

function catalogueSymbols(catalogue,symbol){
 const target=String(symbol||'').trim().toUpperCase();
 const matches=catalogue.filter(i=>[normalizeTicker(i.ticker),currentSymbol(i)].includes(target));
 const isins=new Set(matches.map(i=>i.isin));
 // An alias requires one identified security; never merge similarly named listings.
 if(!matches.length||isins.size!==1||!matches.every(i=>/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(i.isin||'')))return [target];
 const aliases=[...new Set(matches.flatMap(i=>[normalizeTicker(i.ticker),currentSymbol(i)]))];
 if(catalogue.some(i=>aliases.includes(normalizeTicker(i.ticker))&&!isins.has(i.isin)))return [target];
 return [...new Set([target,...aliases])];
}

module.exports = {normalizeTicker, currentSymbol, enrichPositions,catalogueSymbols};
