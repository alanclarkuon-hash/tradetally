const {fail}=require('./tradePlanning'),{stageAccount}=require('./planningAccounts');
function check(coverage,d,stage){
 const account=coverage.accounts?.find(a=>a.accountId===stageAccount(d,'entry',stage.key)),rates={USD:1,...coverage.rates};
 const rate=rates[coverage.currency]>0&&rates[d.currency]>0?rates[coverage.currency]/rates[d.currency]:null;
 const addedRisk=rate&&stage.estimatedRisk!=null?stage.estimatedRisk*rate:null;
 const multiplier=d.instrument==='option'?d.options.contractDelta:d.instrument==='spread_bet'?1/d.pointSize:1;
 const exposure=rate&&multiplier>0&&stage.price>0?stage.quantity*stage.price*multiplier*rate:null;
 const cash=rate&&stage.positionValue!=null?stage.positionValue*rate:null;
 if(addedRisk!=null){if(account?.limit!=null&&account.knownRisk+addedRisk>account.limit)fail('Account risk limit would be exceeded');if(coverage.limit!=null&&account?.inScope&&coverage.knownRisk+addedRisk>coverage.limit)fail('Combined trading-account risk limit would be exceeded');}
 if(exposure!=null&&account?.exposureLimit!=null&&account.knownExposure+exposure>account.exposureLimit)fail('Account exposure limit would be exceeded');
 if(cash!=null&&(d.instrument==='option'||['stock','crypto'].includes(d.instrument)&&d.direction==='long')&&account?.buyingPower!=null&&cash+(account.reservedCash||0)>account.buyingPower)fail('Account buying power is insufficient');
 const quote=d.instrument==='crypto'?String((stageAccount(d,'entry',stage.key)===d.accountId?d.constraints:d.accountConstraints?.[stageAccount(d,'entry',stage.key)])?.pair||'').split(/[-/]/).at(-1):null;
 const wallet=account?.brokerEvidence?.cash?.find(b=>b.currency===(quote||d.currency));
 const walletRate=wallet?.currency===d.currency?1:rates[wallet?.currency]>0&&rates[d.currency]>0?rates[wallet.currency]/rates[d.currency]:null;
 const nativeCost=walletRate&&stage.positionValue!=null?stage.positionValue*walletRate:null;
 const reservedNative=walletRate&&rate&&account?.reservedCash!=null?account.reservedCash/rate*walletRate:0;
 if(wallet&&nativeCost!=null&&nativeCost+reservedNative>wallet.amount+1e-8)fail('Broker available funds are insufficient in the trading currency');
 const verified=coverage.unknown===0&&account?.unknown===0&&addedRisk!=null&&account?.limit!=null&&coverage.limit!=null;
 return {brokerFundsVerified:!!wallet&&nativeCost!=null,brokerFunds:wallet?{...wallet,required:nativeCost,quoteCurrency:quote||d.currency}:null,borrowingVerified:false,addedRisk,exposure,cash,portfolioRiskVerified:verified,exposureVerified:account?.exposureLimit!=null&&account.exposureUnknown===0&&exposure!=null,buyingPowerVerified:cash!=null&&account?.buyingPower!=null&&!account.buyingPowerUnknown&&(d.instrument==='option'||['stock','crypto'].includes(d.instrument)&&d.direction==='long')};
}
module.exports={check};
