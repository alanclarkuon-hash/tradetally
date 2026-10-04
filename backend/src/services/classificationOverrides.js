const fs = require('fs');
const path = require('path');
const taxonomy = require('../reference/gicsHierarchy.json');
const FILE = path.resolve(__dirname, '../../config/stock-classification-overrides.json');

function validateOverrides(document) {
  if(document?.version!==1 || !document.overrides || typeof document.overrides!=='object' || Array.isArray(document.overrides)) {
    throw Error('Use version 1 and an overrides object.');
  }
  const overrides=new Map(),errors=[];
  for(const [symbol,entry] of Object.entries(document.overrides)) {
    const industry=taxonomy.industries[entry?.industry_code];
    if(!/^[A-Z0-9.^=_/-]{1,30}$/.test(symbol) || typeof entry?.industry_code!=='string' || !/^\d{6}$/.test(entry.industry_code) || !industry || (entry.reason!=null && (typeof entry.reason!=='string'||entry.reason.length>500))) {
      errors.push('An override has an invalid symbol, industry code or reason.');continue;
    }
    const group=taxonomy.groups[industry.group];
    // Optional explicit parent codes/names must agree with the chosen branch.
    const fields={sector_code:industry.sector,sector_name:taxonomy.sectors[industry.sector],industry_group_code:industry.group,industry_group_name:group.name,industry_code:entry.industry_code,industry_name:industry.name};
    if(Object.keys(entry).some(key=>!['reason',...Object.keys(fields)].includes(key)) || Object.entries(fields).some(([key,value])=>entry[key]!=null && entry[key]!==value)) {
      errors.push('An override contains inconsistent groups or unsupported fields.');continue;
    }
    overrides.set(symbol,{...fields,override_reason:entry.reason||null});
  }
  return {overrides,errors};
}

function loadOverrides() {
  try {
    const text=fs.readFileSync(FILE,'utf8').replace(/^\uFEFF/,'');
    const result=validateOverrides(JSON.parse(text));
    return {...result,updatedAt:fs.statSync(FILE).mtime.toISOString()};
  } catch(error) {
    return {overrides:new Map(),errors:error.code==='ENOENT'?[]:['The classification override file could not be read. Check its JSON format and version.']};
  }
}

function applyOverrides(symbols, providerRows) {
  const {overrides,errors,updatedAt}=loadOverrides();
  const result=new Map(providerRows);
  for(const symbol of symbols) {
    const override=overrides.get(symbol),provider=providerRows.get(symbol);
    if(override) result.set(symbol,{symbol,...override,source:'Manual override',status:'manual_override',
      override_updated_at:updatedAt,taxonomy_version:taxonomy.source,provider_classification:provider||null});
    if(errors.length) result.set(symbol,{...(result.get(symbol)||{symbol,status:'not_found'}),override_warning:[...new Set(errors)].join(' ')});
  }
  return result;
}
module.exports={applyOverrides,validateOverrides};
