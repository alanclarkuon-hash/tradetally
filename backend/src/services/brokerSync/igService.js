const axios = require('axios');
const db = require('../../config/database');
const ORIGINS = {live:'https://api.ig.com/gateway/deal',demo:'https://demo-api.ig.com/gateway/deal'};
const READS = {'/accounts':'1','/positions':'2','/history/transactions':'2','/history/activity':'3'};
const timestamp = ms => new Date(ms).toISOString().replace(/Z$/, '');
const utcTime = value => Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(value || '') ? value : value+'Z');
function windows(from, to) {
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end-start > 5*366*86400000) {
    throw Error('Choose an IG history start date before today and within the last five years.');
  }
  const ranges = [];
  for (let time=start; time<end; time+=31*86400000) {
    ranges.push({from:timestamp(time),to:timestamp(Math.min(time+31*86400000,end)-1)});
  }
  return ranges;
}
function sanitizedError(error) {
  const code = String(error.response?.data?.errorCode || '');
  let message = 'IG could not be reached. Check your connection and try again later.';
  if (/stockbroking|product-code/.test(code)) message='IG does not expose share dealing through this API. Use the spread-betting account and import share-dealing statements separately.';
  else if (/too-many-failed/.test(code)) message='IG has blocked further login attempts. Stop retrying and check access with IG before trying again.';
  else if (/invalid-details|authentication.failure|credentials/.test(code)) message='IG rejected the login. Check your IG username and password; do not repeatedly retry.';
  else if (/api-key/.test(code)) message='IG rejected the API key. Check that it is enabled and belongs to the selected live or demo environment.';
  else if (/exceeded|allowance/.test(code) || error.response?.status===429) message='IG request allowance reached. Wait before running another download.';
  else if (/pending.agreements|kyc/.test(code)) message='Sign in to IG and complete its required agreements or account checks before connecting.';
  else if (error.response?.status) message=`IG rejected this read request (HTTP ${error.response.status}). Check your account access and API settings.`;
  return Error(message); // Never propagate Axios objects containing credentials.
}

class IgService {
  constructor() { this.queue=Promise.resolve(); this.lastRequestAt=0; }
  async request(connection, method, path, version, {session,params,data}={}) {
    const origin=ORIGINS[connection.brokerEnvironment || 'live'];
    if (!origin || !((method==='GET' && READS[path]===String(version)) ||
      (method==='POST' && path==='/session' && String(version)==='3') ||
      (method==='POST' && path==='/session/refresh-token' && String(version)==='1'))) {
      throw Error('Unsupported IG read or authentication endpoint.');
    }
    const execute=async()=>{
      const wait=Math.max(0,this.lastRequestAt+2200-Date.now());
      if(wait) await new Promise(resolve=>setTimeout(resolve,wait));
      this.lastRequestAt=Date.now();
      const headers={'X-IG-API-KEY':connection.igApiKey,Version:String(version),Accept:'application/json; charset=UTF-8','Content-Type':'application/json'};
      if(session) {
        headers.Authorization='Bearer '+session.access;
        headers['IG-ACCOUNT-ID']=session.accountId;
      }
      let response;
      try {response=await axios.request({method,url:origin+path,headers,params,data,timeout:30000,maxRedirects:0});}
      catch(error) {throw sanitizedError(error);}
      if(response.data?.errorCode)throw sanitizedError({response});
      return response.data;
    };
    const pending=this.queue.then(execute);this.queue=pending.catch(()=>{});return pending;
  }
  tokens(body, accountId) {
    const t=body?.oauthToken || body;
    if(!t?.access_token || !t.refresh_token || !(Number(t.expires_in)>0) || (t.token_type && t.token_type!=='Bearer')) {
      throw Error('IG returned incomplete login tokens.');
    }
    return {access:t.access_token,refresh:t.refresh_token,expiresAt:Date.now()+Number(t.expires_in)*1000,accountId};
  }
  async login(connection) {
    if(!connection.igApiKey || !connection.igUsername || !connection.igPassword)throw Error('IG API key, username and password are required.');
    const body=await this.request(connection,'POST','/session','3',{data:{identifier:connection.igUsername,password:connection.igPassword}});
    if(!body?.accountId)throw Error('IG login did not return an account identifier.');
    return this.tokens(body,body.accountId);
  }
  async get(connection, session, path, params={}) {
    // Tokens are short lived. Refresh only authentication, never retry a failed
    // password or broker read automatically. Secrets remain in memory only.
    if(Date.now()+10000>=session.expiresAt) {
      const body=await this.request(connection,'POST','/session/refresh-token','1',{data:{refresh_token:session.refresh}});
      Object.assign(session,this.tokens(body,session.accountId));
    }
    return this.request(connection,'GET',path,READS[path],{session,params});
  }
  async account(connection, requestedId) {
    const session=await this.login(connection);
    const data=await this.get(connection,session,'/accounts');
    if(!Array.isArray(data?.accounts))throw Error('IG returned incomplete account details.');
    const available=data.accounts.filter(a=>a.accountType==='SPREADBET' && a.status==='ENABLED');
    const selected=requestedId ? available.find(a=>a.accountId===requestedId) : available.length===1?available[0]:null;
    if(!selected)throw Error(available.length>1 ? 'Enter the IG spread-betting account ID to choose between your accounts.' : 'No enabled spread-betting account matched. Share dealing needs statement imports.');
    session.accountId=selected.accountId;
    return {session,selected};
  }
  async validateCredentials(apiKey,username,password,environment='live',accountId) {
    try {
      const {selected}=await this.account({igApiKey:apiKey,igUsername:username,igPassword:password,brokerEnvironment:environment},accountId);
      return {valid:true,accountId:selected.accountId,currency:selected.currency,message:'IG spread-betting read access validated'};
    } catch(error) {return {valid:false,message:error.message};}
  }
  async transactions(connection,session,range) {
    const rows=[];let totalPages;
    for(let page=1;page<=1000;page++) {
      const body=await this.get(connection,session,'/history/transactions',{...range,type:'ALL',pageSize:500,pageNumber:page});
      const paging=body?.metadata?.pageData;
      if(!Array.isArray(body?.transactions) || !paging || Number(paging.pageNumber)!==page ||
        !Number.isInteger(Number(paging.totalPages)) || Number(paging.totalPages)<0 ||
        Number(paging.totalPages)>1000 || (totalPages!==undefined && totalPages!==Number(paging.totalPages))) {
        throw Error('IG transaction pagination was incomplete or changed during download.');
      }
      totalPages=Number(paging.totalPages);rows.push(...body.transactions);
      if(page>=totalPages)return rows;
    }
    throw Error('IG transaction history exceeded the supported page limit.');
  }
  async activities(connection,session,range) {
    const rows=[],seen=new Set();let params={...range,detailed:true,pageSize:500};
    for(let page=0;page<1000;page++) {
      const body=await this.get(connection,session,'/history/activity',params);
      if(!Array.isArray(body?.activities))throw Error('IG returned incomplete activity history.');
      rows.push(...body.activities);
      const next=body.metadata?.paging?.next;
      if(!next) {
        if(!body.metadata?.paging && body.activities.length>=500)throw Error('IG activity pagination metadata is missing.');
        return rows;
      }
      // Treat pagination URLs as untrusted broker data: never follow another
      // host, endpoint or method with authentication headers.
      const base=ORIGINS[connection.brokerEnvironment || 'live'];
      let url;
      try {url=new URL(next,base+'/');} catch {throw Error('IG activity pagination URL is invalid.');}
      if(url.origin!==new URL(base).origin || !['/history/activity','/gateway/deal/history/activity'].includes(url.pathname) ||
        url.username || url.password || url.hash || seen.has(url.href))throw Error('IG activity pagination did not advance safely.');
      seen.add(url.href);
      const nextParams=Object.fromEntries(url.searchParams);
      if(Object.keys(nextParams).some(key=>!['from','to','detailed','pageSize','version'].includes(key)))throw Error('Unsupported IG activity cursor.');
      params={...range,...nextParams,detailed:true,pageSize:500};delete params.version;
      if(!Number.isFinite(utcTime(params.from)) || !Number.isFinite(utcTime(params.to)) ||
        utcTime(params.to)>utcTime(range.to) || utcTime(params.from)<utcTime(range.from) || utcTime(params.from)>utcTime(params.to)) {
        throw Error('IG activity pagination left the requested history window.');
      }
    }
    throw Error('IG activity history exceeded the supported page limit.');
  }
  async syncTrades(connection,{startDate,endDate}={}) {
    const asOf=new Date().toISOString();
    const to=endDate ? new Date(Date.parse(String(endDate).slice(0,10)+'T00:00:00Z')+86400000).toISOString() : asOf;
    const ranges=windows(startDate || connection.syncStartDate || '2025-09-01',Date.parse(to)>Date.parse(asOf)?asOf:to);
    const {session,selected}=await this.account(connection,connection.externalAccountId);
    const positions=await this.get(connection,session,'/positions');
    if(!Array.isArray(positions?.positions))throw Error('IG returned incomplete open positions.');
    const transactions=[],activities=[];
    for(const range of ranges) {
      transactions.push(...await this.transactions(connection,session,range));
      activities.push(...await this.activities(connection,session,range));
    }
    const payload={version:1,asOf,account:selected,positions:positions.positions,transactions,activities,
      requestedRanges:ranges,windowsCompleted:ranges.length,historyDownloaded:true,reconciled:false};
    await db.query(`INSERT INTO broker_import_snapshots(user_id,broker_type,account_identifier,connection_id,payload,captured_at)
      VALUES($1,'ig',$2,$3,$4::jsonb,NOW()) ON CONFLICT(user_id,broker_type,account_identifier)
      DO UPDATE SET connection_id=EXCLUDED.connection_id,payload=EXCLUDED.payload,captured_at=NOW()`,
    [connection.userId,`IG Spread Betting ****${String(selected.accountId).slice(-4)}`,connection.id,JSON.stringify(payload)]);
    return {imported:0,skipped:0,failed:0,duplicates:0,outcome:'warning',tradeRows:transactions.filter(t=>!t.cashTransaction).length,
      openPositionRows:positions.positions.length,windowsRequested:ranges.length,windowsCompleted:ranges.length,requestedRanges:ranges,
      warnings:[`IG downloaded ${transactions.length} transaction rows, ${activities.length} activity rows and ${positions.positions.length} open positions privately. Amounts, spread-bet stakes, fees and history coverage need reconciliation before reports and auto-sync can be enabled. Share dealing is separate.`]};
  }
}
module.exports=new IgService();
module.exports.IgService=IgService;
module.exports.windows=windows;
module.exports.sanitizedError=sanitizedError;
