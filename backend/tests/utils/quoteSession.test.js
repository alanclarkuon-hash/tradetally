const {normalizeSession,yahooQuote}=require('../../src/utils/quoteSession');
const now=Math.floor(Date.now()/1000);
const response=(t,close,periods)=>({meta:{regularMarketPrice:100,regularMarketTime:now-1000,currentTradingPeriod:periods},timestamp:[t],indicators:{quote:[{close:[close]}]}});
test('selects later pre/post candles only inside provider supplied dated boundaries',()=>{
  for(const session of ['pre','post']){
    const q=yahooQuote(response(now-30,101,{[session]:{start:now-100,end:now+100}}));
    expect(q).toEqual({c:101,t:now-30,session});
  }
});
test('does not infer a session for old candles, null prices, future timestamps or unknown sessions',()=>{
  expect(yahooQuote(response(now-30,101,{post:{start:now+100,end:now+200}}))).toEqual({c:100,t:now-1000,session:'regular'});
  expect(yahooQuote(response(now-30,null,{post:{start:now-100,end:now+100}})).c).toBe(100);
  expect(yahooQuote(response(now+1000,999,{post:{start:now,end:now+2000}})).c).toBe(100);
  expect(yahooQuote({meta:{regularMarketPrice:100}}).session).toBeNull();
  expect(normalizeSession('closed')).toBeNull();
});
test('keeps regular-market quotes rather than replacing them with minute candles',()=>{
  expect(yahooQuote(response(now-30,101,{regular:{start:now-100,end:now+100}})).c).toBe(100);
});
