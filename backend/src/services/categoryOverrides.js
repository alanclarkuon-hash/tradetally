const fs = require('fs');
const path = require('path');
const FILE = path.resolve(__dirname, '../../config/category-classification-overrides.json');

function validateCategoryOverrides(document) {
  if (document?.version !== 1 || !document.overrides || typeof document.overrides !== 'object' || Array.isArray(document.overrides)) throw Error('Use version 1 and an overrides object.');
  const entries = new Map(), errors = [];
  for (const [kind, symbols] of Object.entries(document.overrides)) {
    if (!['crypto', 'fund'].includes(kind) || !symbols || typeof symbols !== 'object' || Array.isArray(symbols)) { errors.push('Invalid category asset type.'); continue; }
    for (const [symbol, entry] of Object.entries(symbols)) {
      let url;
      try { url = new URL(entry?.source_url); } catch { /* rejected below */ }
      if (!/^[A-Z0-9.^=_/-]{1,30}$/.test(symbol) || typeof entry?.category !== 'string' || !entry.category.trim() || entry.category.length > 100 || typeof entry?.reason !== 'string' || entry.reason.length > 500 || url?.protocol !== 'https:' || Object.keys(entry).some(k => !['category', 'reason', 'source_url'].includes(k))) {
        errors.push('Invalid category symbol, label, reason or HTTPS source.'); continue;
      }
      entries.set(`${kind}:${symbol}`, {...entry, category: entry.category.trim()});
    }
  }
  return {entries, errors};
}

// Apply after provider lookup; never mutate or write the provider's cache.
function applyCategoryOverride(symbol, kind, provider) {
  let loaded, asOf;
  try {
    loaded = validateCategoryOverrides(JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')));
    asOf = fs.statSync(FILE).mtime.toISOString();
  } catch (error) {
    return error.code === 'ENOENT' ? provider : {...provider, override_warning: 'Check the category override file JSON format and version.'};
  }
  const entry = loaded.entries.get(`${kind}:${symbol}`);
  const result = entry ? {
    ...provider, primaryCategory: entry.category,
    categories: [...new Set([entry.category, ...(provider?.categories || [])])],
    source: 'Manual override', asOf, stale: false,
    override_reason: entry.reason, source_url: entry.source_url,
    provider_classification: provider || null
  } : provider;
  return loaded.errors.length ? {...result, override_warning: [...new Set(loaded.errors)].join(' ')} : result;
}

module.exports = {applyCategoryOverride, validateCategoryOverrides};
