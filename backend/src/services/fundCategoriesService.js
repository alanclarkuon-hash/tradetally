const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const cache = require('../utils/cache');

function parseLabels(html, symbol) {
  const $ = cheerio.load(html);
  // Require the page's declared identity, including its exchange suffix.
  const identity = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
  const match = identity?.match(/\/quote\/([^/]+)/);
  if (!match || decodeURIComponent(match[1]).toUpperCase() !== symbol.toUpperCase()) return null;
  const labels = {};
  $('h3').each((_, heading) => {
    const key = $(heading).text().trim();
    if (['Fund Category', 'Fund Family'].includes(key)) {
      const value = $(heading).parent().find('p').first().text().trim();
      if (value && value !== '--') labels[key] = value;
    }
  });
  return {primaryCategory:labels['Fund Category'] || null,
    categories:Object.entries(labels).map(([key,value])=>`${key}: ${value}`),source:'Yahoo Finance'};
}

async function getCategories(symbol) {
  const key = String(symbol).toUpperCase();
  const existing = await cache.get('yahoo_fund_labels', key);
  if (existing) return existing;
  let labels = null;
  try {
    const response = await axios.get(`https://finance.yahoo.com/quote/${encodeURIComponent(key)}/`, {
      timeout:8000, maxRedirects:0, maxContentLength:3000000,
      headers:{'User-Agent':'Mozilla/5.0',Accept:'text/html'},
      // Yahoo's public pages sometimes send large response headers.
      transport:{request:(options,callback)=>https.request({...options,maxHeaderSize:65536},callback)}
    });
    labels = parseLabels(response.data, key);
  } catch { /* Missing or blocked metadata is not a financial import failure. */ }
  const result = {...(labels || {primaryCategory:null,categories:[],source:'Yahoo Finance'}),asOf:new Date().toISOString()};
  await cache.set('yahoo_fund_labels', key, result, 86400000);
  return result;
}
module.exports = {getCategories,parseLabels};
