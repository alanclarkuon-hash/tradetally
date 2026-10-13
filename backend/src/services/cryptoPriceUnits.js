// eToro documents SHIBxM as one million SHIB units. Only crypto providers
// translate the underlying quote; broker-native lot quotes remain unchanged.
// https://www.etoro.com/markets/shibxm
function underlying(symbol){return String(symbol).toUpperCase()==='SHIBXM'?{symbol:'SHIB',units:1000000}:{symbol:String(symbol).toUpperCase(),units:1};}
function scale(candles,units){return candles.map(c=>({...c,...Object.fromEntries(['open','high','low','close'].filter(k=>c[k]!=null).map(k=>[k,c[k]*units])),...(c.volume!=null?{volume:c.volume/units}:{})}));}
// Conservative windows before the successor existed. These are not broker
// conversion dates: once both tokens existed we require dated broker evidence.
const predecessors={
 A:{symbol:'EOS',until:'2025-03-17',source:'https://www.prnewswire.com/news-releases/eos-rebrands-to-vaulta-announces-strategic-shift-to-web3-banking-and-banking-advisory-group-302404988.html'},
 POL:{symbol:'MATIC',until:'2023-10-24',source:'https://polygon.technology/blog/polygon-2-0-milestone-pol-contracts-are-live-on-ethereum-mainnet'},
 S:{symbol:'FTM',until:'2024-12-17',source:'https://www.soniclabs.com/blog/sonic-mainnet-launch-evm-compatible-verifiable-10-000-tps-and-sub-second-finality'}
};
function archiveSegments(symbol,from,to) {
 const predecessor=predecessors[String(symbol).toUpperCase()];
 if(!predecessor||from>predecessor.until)return [{symbol:underlying(symbol).symbol,from,to}];
 const end=to<predecessor.until?to:predecessor.until;
 const segments=[{symbol:predecessor.symbol,from,to:end}];
 if(to>end)segments.push({symbol:underlying(symbol).symbol,from:new Date(Date.parse(end)+86400000).toISOString().slice(0,10),to});
 return segments;
}
module.exports={underlying,scale,archiveSegments};
