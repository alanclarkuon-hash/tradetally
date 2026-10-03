const axios = require('axios');
const {parse} = require('csv-parse/sync');
const db = require('../config/database');
const taxonomy = require('../reference/gicsHierarchy.json');
const DAY = 86400000;
const BASE = 'https://raw.githubusercontent.com/JerBouma/FinanceDatabase/main/database/equities/';
const US = ['NMS','NYQ','NGM','NCM','ASE','PCX','BTS','PNK','OBB','OQB','OQX','OEM'];
const EXCHANGES = {L:['LSE'],DE:['GER'],F:['FRA'],AS:['AMS'],PA:['PAR'],MI:['MIL'],SW:['EBS'],TO:['TOR'],V:['VAN'],AX:['ASX'],HK:['HKG'],T:['JPX'],ST:['STO'],OL:['OSL'],CO:['CPH'],HE:['HEL'],BR:['BRU'],MC:['MCE'],LS:['LIS'],SI:['SES'],NZ:['NZE'],SA:['SAO']};
const datasets = new Map();
const pending = new Map();
const normalize = value => String(value || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');

function exchangesFor(symbol) {
  return symbol.includes('.') ? (EXCHANGES[symbol.split('.').at(-1)] || []) : US;
}

// Exact symbol including its exchange suffix. Never infer an equity from a
// crypto ticker or copy classifications from a similarly named stock.
function classify(symbol, rows) {
  const matches = rows.filter(row => String(row.symbol).toUpperCase() === symbol);
  const unique = new Set(matches.map(row => [row.sector,row.industry_group,row.industry].map(normalize).join('|')));
  if (!matches.length) return {symbol,status:'not_found'};
  if (unique.size !== 1) return {symbol,status:'conflict'};
  const row = matches[0];
  const sector = Object.entries(taxonomy.sectors).find(([,name])=>normalize(name)===normalize(row.sector));
  const group = Object.entries(taxonomy.groups).find(([,g])=>g.sector===sector?.[0] && normalize(g.name)===normalize(row.industry_group));
  const industry = Object.entries(taxonomy.industries).find(([,i])=>i.group===group?.[0] && normalize(i.name)===normalize(row.industry));
  return {symbol,sector_name:row.sector||null,sector_code:sector?.[0]||null,
    industry_group_name:row.industry_group||null,industry_group_code:group?.[0]||null,
    industry_name:row.industry||null,industry_code:industry?.[0]||null,
    source_exchange:row.exchange,
    status:industry?'matched':'unmapped'};
}

async function readExchange(exchange) {
  const cached = datasets.get(exchange);
  if(cached && Date.now()-cached.at<DAY) return cached.promise;
  const promise = axios.get(`${BASE}${exchange}.csv`,{timeout:15000,maxContentLength:30000000})
    .then(response=>parse(response.data,{columns:true,bom:true,skip_empty_lines:true}));
  datasets.set(exchange,{at:Date.now(),promise});
  try { return await promise; }
  catch(error) { datasets.delete(exchange); throw error; }
}

async function getClassifications(symbols, {refresh=false}={}) {
  const wanted=[...new Set(symbols.map(s=>String(s).trim().toUpperCase()).filter(s=>/^[A-Z0-9.^=_/-]{1,30}$/.test(s)))];
  if(!wanted.length) return new Map();
  const stored=(await db.query('SELECT * FROM asset_reference_classifications WHERE symbol=ANY($1)',[wanted])).rows;
  const result=new Map(stored.map(row=>[row.symbol,row]));
  const stale=wanted.filter(s=>refresh || !result.has(s) || Date.now()-new Date(result.get(s).fetched_at).getTime()>30*DAY);
  // Sequential symbols share one download per exchange. Concurrent callers
  // coalesce each symbol to avoid overlapping writes and upstream requests.
  for(const symbol of stale) {
    if(!pending.has(symbol)) pending.set(symbol,(async()=>{
      const exchanges=exchangesFor(symbol);
      if(!exchanges.length) return null;
      const rows=[];
      for(const exchange of exchanges) rows.push(...await readExchange(exchange));
      const row=classify(symbol,rows);
      const sourceUrl=exchanges.includes(row.source_exchange)?`${BASE}${row.source_exchange}.csv`:'https://github.com/JerBouma/FinanceDatabase/tree/main/database/equities';
      const values=[symbol,row.sector_name||null,row.sector_code||null,row.industry_group_name||null,row.industry_group_code||null,row.industry_name||null,row.industry_code||null,sourceUrl,taxonomy.source,row.status];
      const saved=await db.query(`INSERT INTO asset_reference_classifications
        (symbol,sector_name,sector_code,industry_group_name,industry_group_code,industry_name,industry_code,source_url,taxonomy_version,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(symbol) DO UPDATE SET
        sector_name=EXCLUDED.sector_name,sector_code=EXCLUDED.sector_code,
        industry_group_name=EXCLUDED.industry_group_name,industry_group_code=EXCLUDED.industry_group_code,
        industry_name=EXCLUDED.industry_name,industry_code=EXCLUDED.industry_code,
        source_url=EXCLUDED.source_url,taxonomy_version=EXCLUDED.taxonomy_version,status=EXCLUDED.status,fetched_at=NOW()
        RETURNING *`,values);
      return saved.rows[0];
    })());
    try { const row=await pending.get(symbol);if(row)result.set(symbol,row); }
    catch (_) { /* Preserve last known metadata during a public dataset outage. */ }
    finally { pending.delete(symbol); }
  }
  return result;
}
async function enrichExistingStocks() {
  const result=await db.query(`SELECT DISTINCT symbol FROM trades WHERE COALESCE(instrument_type,'stock')='stock'
    UNION SELECT h.symbol FROM investment_holdings h WHERE NOT EXISTS
    (SELECT 1 FROM trades t WHERE t.symbol=h.symbol AND t.instrument_type='crypto')`);
  const rows=await getClassifications(result.rows.map(row=>row.symbol));
  return {total:result.rows.length,matched:[...rows.values()].filter(row=>row.status==='matched').length,
    unmapped:[...rows.values()].filter(row=>row.status==='unmapped').length,
    unavailable:result.rows.length-[...rows.values()].filter(row=>['matched','unmapped'].includes(row.status)).length};
}
module.exports={getClassifications,classify,exchangesFor,enrichExistingStocks};
