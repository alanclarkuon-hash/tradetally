const axios = require('axios');
const {createHmac} = require('crypto');
const {isDeepStrictEqual} = require('util');
const db = require('../../config/database');

const ORIGINS = {global:'https://www.okx.com',eea:'https://eea.okx.com',us:'https://us.okx.com'};
const PATHS = new Set(['/api/v5/account/config','/api/v5/account/balance','/api/v5/account/positions',
  '/api/v5/asset/balances','/api/v5/asset/deposit-history','/api/v5/asset/withdrawal-history',
  '/api/v5/trade/fills-history','/api/v5/account/bills-archive']);
const HISTORY_WARNING = 'OKX recent fills and account bills cover three months. Older history must be reconciled using archived bills or account exports before profit figures are complete.';

function signedHeaders(connection, path, timestamp) {
  if (!connection.okxApiKey || !connection.okxApiSecret || !connection.okxPassphrase) throw new Error('OKX API key, secret and passphrase are required.');
  return {'OK-ACCESS-KEY':connection.okxApiKey,'OK-ACCESS-PASSPHRASE':connection.okxPassphrase,
    'OK-ACCESS-TIMESTAMP':timestamp,'OK-ACCESS-SIGN':createHmac('sha256',connection.okxApiSecret)
      .update(timestamp+'GET'+path).digest('base64')};
}

class OkxService {
  constructor() { this.queue=Promise.resolve(); this.lastRequestAt=0; }
  async get(connection,path,params={}) {
    const request=this.queue.then(()=>this.read(connection,path,params));
    this.queue=request.catch(()=>{});
    return request;
  }
  async read(connection,path,params) {
    const origin=ORIGINS[connection.brokerEnvironment || 'global'];
    if (!origin || !PATHS.has(path)) throw new Error('Unsupported OKX read endpoint or region.');
    const query=new URLSearchParams(params).toString();
    const requestPath=path+(query?'?'+query:'');
    const wait=Math.max(0,this.lastRequestAt+500-Date.now());
    if(wait) await new Promise(resolve=>setTimeout(resolve,wait));
    this.lastRequestAt=Date.now();
    const headers=signedHeaders(connection,requestPath,new Date().toISOString());
    let response;
    try { response=await axios.get(origin+requestPath,{headers,timeout:30000,maxRedirects:0}); }
    catch(error) {
      const status=error.response?.status;
      const failure=new Error(status===429 ? 'OKX rate limit reached. Please wait before retrying.' :
        `Unable to read OKX data${status?` (HTTP ${status})`:''}. Check the selected region, keys and IP restrictions.`);
      failure.transient=status===429 || status>=500 || !error.response;
      throw failure; // Axios errors contain secrets; never propagate them.
    }
    const body=response.data;
    if(body?.code!=='0' || !Array.isArray(body.data)) {
      const error=new Error(body?.code==='50102' ? 'OKX rejected the request timestamp. Check this PC’s clock.' :
        'OKX rejected the request. Check the selected region and read-only API credentials.');
      error.transient=body?.code==='50011';
      throw error;
    }
    return body.data;
  }
  async validateCredentials(apiKey,apiSecret,passphrase,region='global') {
    try {
      const [config]=await this.get({okxApiKey:apiKey,okxApiSecret:apiSecret,okxPassphrase:passphrase,brokerEnvironment:region},'/api/v5/account/config');
      if(!config?.uid || config.perm!=='read_only') throw new Error('Use an OKX key with Read permission only; disable Trade and Withdraw.');
      return {valid:true,accountId:String(config.uid),message:'OKX read-only connection validated'};
    } catch(error) { return {valid:false,message:error.message}; }
  }
  async pages(connection,path,params={}) {
    const rows=new Map();const cursors=new Set();let after;
    for(let page=0;page<1000;page++) {
      const data=await this.get(connection,path,{...params,limit:'100',...(after?{after}:{})});
      for(const row of data) {
        if(!row.billId) throw new Error('OKX returned a history row without its bill identity.');
        const id=String(row.billId),old=rows.get(id);
        if(old && !isDeepStrictEqual(old,row)) throw new Error('OKX returned conflicting bill identities.');
        rows.set(id,row);
      }
      if(data.length<100) return [...rows.values()];
      after=String(data.at(-1).billId);
      if(cursors.has(after)) throw new Error('OKX history pagination did not advance.');
      cursors.add(after);
    }
    throw new Error('OKX history exceeded the maximum supported pages.');
  }
  async syncTrades(connection) {
    const [config]=await this.get(connection,'/api/v5/account/config');
    if(String(config?.uid)!==String(connection.externalAccountId) || config?.perm!=='read_only') throw new Error('OKX account identity or read-only permissions changed.');
    const trading=await this.get(connection,'/api/v5/account/balance');
    if(trading.length!==1 || !Array.isArray(trading[0].details)) throw new Error('Incomplete OKX trading balance.');
    const funding=await this.get(connection,'/api/v5/asset/balances');
    const positions=await this.get(connection,'/api/v5/account/positions');
    const fills=await this.pages(connection,'/api/v5/trade/fills-history',{instType:'SPOT'});
    const bills=await this.pages(connection,'/api/v5/account/bills-archive');
    const deposits=await this.transferPages(connection,'/api/v5/asset/deposit-history','depId');
    const withdrawals=await this.transferPages(connection,'/api/v5/asset/withdrawal-history','wdId');
    if(!connection.brokerMetadata?.import_pending_review) {
      const rates=await this.indexRates(connection,trading);
      return require('./okxReconcile').reconcile(connection,{trading,funding,positions,fills,bills,deposits,withdrawals,transferHistoryMayBeTruncated:false,asOf:new Date().toISOString()},rates);
    }
    await db.query(`INSERT INTO broker_import_snapshots(user_id,broker_type,account_identifier,connection_id,payload,captured_at)
      VALUES($1,'okx',$2,$3,$4::jsonb,NOW()) ON CONFLICT(user_id,broker_type,account_identifier)
      DO UPDATE SET connection_id=EXCLUDED.connection_id,payload=EXCLUDED.payload,captured_at=NOW()`,
    [connection.userId,`OKX ****${String(connection.externalAccountId).slice(-4)}`,connection.id,
      JSON.stringify({trading,funding,positions,fills,bills,deposits,withdrawals,historyComplete:false,
        transferHistoryMayBeTruncated:false})]);
    return {imported:0,skipped:0,failed:0,duplicates:0,warnings:[HISTORY_WARNING,
      'OKX balances and recent history downloaded privately for reconciliation. Reports are unchanged until this account’s history is checked.'],
      outcome:'warning',tradeRows:fills.length,openPositionRows:trading[0].details.length};
  }
  async transferPages(connection,path,identity) {
    const rows=new Map();let after=null;
    for(let page=0;page<1000;page++) {
      const data=await this.get(connection,path,{limit:'100',...(after?{after}:{})});
      for(const row of data) {
        if(!row[identity]||!/^\d+$/.test(String(row.ts))||!Number.isSafeInteger(Number(row.ts)))throw Error('OKX returned invalid transfer history identity or time.');
        const id=String(row[identity]),old=rows.get(id);
        if(old&&!isDeepStrictEqual(old,row))throw Error('OKX returned conflicting transfer history identities.');
        rows.set(id,row);
      }
      if(data.length<100)return [...rows.values()];
      // Overlap the last millisecond so equal-time records are not skipped.
      const next=String(Math.min(...data.map(r=>Number(r.ts)))+1);
      if(after&&Number(next)>=Number(after))throw Error('OKX transfer pagination did not advance; timestamp boundary requires review.');
      after=next;
    }
    throw Error('OKX transfer history exceeded the maximum supported pages.');
  }
  async indexRates(connection,trading) {
    const origin=ORIGINS[connection.brokerEnvironment||'global'];
    if(!origin)throw new Error('Unsupported OKX region');
    let response;
    try {response=await axios.get(origin+'/api/v5/market/history-index-candles',
      {params:{instId:'USDT-USD',bar:'1Dutc',limit:'100'},timeout:30000,maxRedirects:0});}
    catch {throw new Error('Unable to retrieve the historical OKX USDT/USD index. Previous reports were preserved.');}
    if(response.data?.code!=='0'||!Array.isArray(response.data.data))throw new Error('Invalid OKX USDT/USD index');
    const rates={};
    for(const candle of response.data.data){const rate=Number(candle[4]);if(!(rate>0))throw new Error('Invalid OKX index price');rates[new Date(Number(candle[0])).toISOString().slice(0,10)]=rate;}
    const usdt=trading[0].details.find(x=>x.ccy==='USDT');
    if(Number(usdt?.cashBal)>0)rates[new Date().toISOString().slice(0,10)]=Number(usdt.eqUsd)/Number(usdt.cashBal);
    return rates;
  }
}
module.exports=new OkxService();
module.exports.signedHeaders=signedHeaders;
