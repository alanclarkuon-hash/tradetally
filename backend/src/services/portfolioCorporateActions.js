// Public security reference data used only by historical reconstruction.
// Broker execution keys and original trades are deliberately preserved.
const aliases={
 SRNG:'DNA',
 // Yahoo stores the continuous same-share price history under the new ticker.
 // https://investor.atmeta.com/investor-news/press-release-details/2022/Meta-Platforms-Inc.-to-Change-Ticker-Symbol-to-META-on-June-9/default.aspx
 FB:'META',
 // https://infomemo.theocc.com/infomemos?number=55886
 SQ:'XYZ',
 // User-confirmed listing / permanent broker-key corrections.
 RHMD_EQ:'RHM.DE',IPOE:'SOFI',UBNT:'UI'
};
const splits={
 DNA:[{date:'2024-08-20',ratio:1/40,source:'https://www.prnewswire.com/news-releases/ginkgo-regains-compliance-with-nyse-minimum-bid-price-requirement-302238512.html'}],
 TWOU:[{date:'2024-06-14',ratio:1/30,source:'https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2024-278'}]
};
// SRNG became DNA in September 2021, before supported T212 account history.
// https://www.sec.gov/Archives/edgar/data/1830214/000119312521277420/d186750d8k.htm
function historySymbol(symbol,date) {
 return symbol==='SRNG'&&date<'2021-09-17'?symbol:aliases[symbol]||symbol;
}
function historySplits(symbol,providerSplits=[]) {
 const result=[...providerSplits];
 for(const split of splits[symbol]||[])if(!result.some(s=>s.date===split.date))result.push({...split});
 return result.sort((a,b)=>a.date.localeCompare(b.date));
}
module.exports={historySymbol,historySplits};
