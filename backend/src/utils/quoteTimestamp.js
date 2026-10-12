function tradeTimestamp(value){const n=Number(value),ms=n>1e11?n:n*1000;return value!=null&&Number.isFinite(ms)&&ms>0&&ms<=Date.now()+60000?ms/1000:null;}
module.exports={tradeTimestamp};
