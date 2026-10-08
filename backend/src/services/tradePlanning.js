const Joi = require('joi');
const uuid = Joi.string().guid({ version: ['uuidv4','uuidv5'] });
const stageSchema = Joi.object({ key:Joi.string().pattern(/^[a-zA-Z0-9_-]{1,64}$/).required(), label:Joi.string().max(120).required(), price:Joi.number().positive().allow(null).required(), riskWeight:Joi.number().min(0).max(100).required(), tactic:Joi.string().max(1000).allow('').default(''), units:Joi.number().min(0).allow(null).default(null), marketContext:Joi.array().items(Joi.string().max(100)).max(20).default([]), tactics:Joi.array().items(Joi.string().max(100)).max(20).default([]) });
const schema = Joi.object({
 title:Joi.string().max(160).required(), symbol:Joi.string().trim().max(40).required(), assetName:Joi.string().max(120).allow('').default(''),
 instrument:Joi.string().valid('stock','crypto','spread_bet','option').required(), direction:Joi.string().valid('long','short').required(),
 accountId:uuid.allow(null).default(null), currency:Joi.string().pattern(/^[A-Z]{3}$/).required(), playbookId:uuid.allow(null).default(null),
 riskBudget:Joi.number().positive().allow(null).required(), stopPrice:Joi.number().positive().allow(null).required(),
 quantityStep:Joi.number().positive().max(1000).required(), pointSize:Joi.number().positive().default(1),
 exposureSystem:Joi.boolean().default(false), portfolioAmount:Joi.number().positive().allow(null).default(null), portfolioRiskPercent:Joi.number().min(0).max(100).allow(null).default(null), setup:Joi.string().max(200).allow('').default(''),
 runnerMode:Joi.string().valid('legacy','row').default('legacy'),
 runnerEstimatePrice:Joi.number().positive().allow(null).default(null),
 thesis:Joi.string().max(5000).allow('').default(''), runnerRule:Joi.string().max(2000).allow('').default(''), chartUrl:Joi.string().uri({scheme:['https']}).max(2000).allow('').default(''),
 preparation:Joi.array().max(40).items(Joi.object({key:Joi.string().max(80).required(),label:Joi.string().max(300).required(),done:Joi.boolean().required()})).default([]),
 exceptionReason:Joi.string().max(2000).allow('').default(''),
 entries:Joi.array().min(1).max(20).items(stageSchema).required(),
 exits:Joi.array().max(20).items(Joi.object({key:Joi.string().max(64).required(),label:Joi.string().max(120).required(),price:Joi.number().positive().allow(null).required(),percent:Joi.number().min(0).max(100).required(), units:Joi.number().min(0).allow(null).default(null), premium:Joi.number().positive().allow(null).default(null), marketContext:Joi.array().items(Joi.string().max(100)).max(20).default([]), tactics:Joi.array().items(Joi.string().max(100)).max(20).default([])})).required(),
 options:Joi.object({contract:Joi.string().max(180).allow('').default(''),type:Joi.string().valid('call','put').default('call'),strike:Joi.number().positive().allow(null).default(null),expiry:Joi.string().isoDate().allow(null).default(null),premium:Joi.number().positive().allow(null).default(null),multiplier:Joi.number().positive().default(100),contractDelta:Joi.number().positive().allow(null).default(null),atr:Joi.number().positive().allow(null).default(null),atrMultiplier:Joi.number().positive().default(2),atrPeriod:Joi.number().integer().min(1).max(500).default(14),atrTimeframe:Joi.string().max(40).default('Daily'),source:Joi.string().max(300).allow('').default(''),asOf:Joi.string().isoDate().allow(null).default(null)}).default({})
});
function fail(message,status=422){const e=new Error(message);e.status=status;throw e;}
function normalize(input){const r=schema.required().validate(input,{abortEarly:true,convert:false});if(r.error)fail(r.error.details[0].message);const d=r.value; if(new Set(d.entries.map(e=>e.key)).size!==d.entries.length)fail('Entry keys must be unique');if(new Set(d.exits.map(e=>e.key)).size!==d.exits.length)fail('Exit keys must be unique');if(d.entries.reduce((s,e)=>s+e.riskWeight,0)>100.00000001)fail('Entry risk weights cannot exceed 100%');if(d.exits.reduce((s,e)=>s+e.percent,0)>100.00000001)fail('Exit percentages cannot exceed 100%');if(d.instrument==='option'&&d.quantityStep!==1)fail('Options require whole-contract quantities');return d;}
function floorQuantity(q,step){let units=Math.floor(q/step);let result=units*step;while(result>q&&units>0){result=(--units)*step;}return result;}
function calculateReward(d,stages){
 const runner=d.exits.find(e=>e.key==='runner');
 const runnerPercent=runner?.percent??(d.runnerMode==='row'?0:100-d.exits.reduce((s,e)=>s+e.percent,0));
 const targets=d.exits.filter(e=>e.key!=='runner'&&e.percent>0);
 const approximate=d.instrument==='option';
 const multiplier=d.instrument==='spread_bet'?1/d.pointSize:approximate?d.options.contractDelta:1;
 const total=stages.reduce((v,s)=>v+(s.quantity||0),0);
 const ready=stages.every(s=>s.quantity>0&&s.price>0)&&multiplier>0;
 const fixedReady=ready&&targets.every(e=>approximate?e.premium>0:e.price>0);
 const profit=(e)=>{const weight=e.units!=null?e.units/total*100:e.percent;return approximate?stages.reduce((v,s)=>v+s.quantity*(e.premium-d.options.premium)*d.options.multiplier*weight/100,0):stages.reduce((sum,s)=>sum+s.quantity*(d.direction==='long'?e.price-s.price:s.price-e.price)*multiplier*weight/100,0)};
 const fixedTargetProfit=fixedReady?targets.reduce((sum,e)=>sum+profit(e),0):null;
 const runnerTarget=runner||{price:d.runnerEstimatePrice,percent:runnerPercent};
 const complete=fixedReady&&(d.runnerMode!=='row'||d.exits.reduce((s,e)=>s+e.percent,0)>=99.999999)&&(runnerPercent<=0||(approximate?runnerTarget.premium>0:runnerTarget.price>0));
 const totalPotentialProfit=complete?fixedTargetProfit+(runnerPercent>0?profit(runnerTarget):0):null;
 return {fixedTargetProfit,totalPotentialProfit,fixedTargetRR:fixedTargetProfit!==null&&d.riskBudget>0?fixedTargetProfit/d.riskBudget:null,expectedRR:totalPotentialProfit!==null&&d.riskBudget>0?totalPotentialProfit/d.riskBudget:null,runnerPercent,approximate,basis:'Full planned entries and original plan risk budget; before fees, slippage and FX. Options require explicit premium targets; underlying levels alone do not predict premium profit.'};
}
function calculate(d){const warnings=[], stages=d.entries.map(e=>{const cashRisk=d.riskBudget==null?null:d.riskBudget*e.riskWeight/100;let stop=d.stopPrice,distance=e.price==null||stop==null?null:Math.abs(e.price-stop);if(d.instrument==='option'){distance=d.options.atr&&d.options.atrMultiplier?d.options.atr*d.options.atrMultiplier:null;stop=distance&&e.price?(d.direction==='long'?e.price-distance:e.price+distance):null;}
const validDirection=e.price&&stop&&(d.direction==='long'?stop<e.price:stop>e.price);let denominator=distance;if(d.instrument==='spread_bet'&&distance)denominator=distance/d.pointSize;if(d.instrument==='option')denominator=distance&&d.options.contractDelta?distance*d.options.contractDelta:null;
const calculatedQuantity=validDirection&&denominator>0&&cashRisk>0?floorQuantity(cashRisk/denominator,d.quantityStep):null;
const quantity=e.units!=null?floorQuantity(e.units,d.quantityStep):calculatedQuantity;
const positionValue=quantity==null?null:d.instrument==='option'?(d.options.premium?quantity*d.options.premium*d.options.multiplier:null):d.instrument==='spread_bet'?null:quantity*e.price;
return {...e,stopPrice:stop,distance,slPercent:distance&&e.price?distance/e.price*100:null,cashRisk,quantity,positionValue,estimatedRisk:quantity==null||denominator==null?null:quantity*denominator};});
if(stages.some(e=>e.quantity==null))warnings.push('Some stages lack valid sizing inputs or stop direction.');if(d.instrument==='option')warnings.push('ATR/delta sizing is an approximation; Greeks and maximum-loss integration are pending.');warnings.push('Prices, costs and risk inputs are user supplied. Broker constraints, FX and whole-portfolio checks are not yet connected.');return {stages,reward:calculateReward(d,stages),plannedQuantity:stages.every(e=>e.quantity!=null)?stages.reduce((s,e)=>s+e.quantity,0):null,plannedValue:stages.every(e=>e.positionValue!=null)?stages.reduce((s,e)=>s+e.positionValue,0):null,runnerPercent:calculateReward(d,stages).runnerPercent,warnings};}
function checkReady(d){if(!d.playbookId||!d.accountId||!d.thesis.trim()||!d.riskBudget)fail('Ready requires a playbook, account, thesis and risk budget');const c=calculate(d);if(c.stages.some(e=>!(e.quantity>0)))fail('Complete valid entry sizing before marking Ready');if(!d.exits.length&&c.runnerPercent<=0)fail('Add an exit row before marking Ready');if(d.entries.some(e=>!e.tactic.trim()&&!e.tactics?.length))fail('Record each entry trigger/tactic');if((!d.chartUrl||d.preparation.some(e=>!e.done))&&!d.exceptionReason.trim())fail('Complete chart/preparation evidence or record an exception reason');return c;}
module.exports={normalize,calculate,checkReady,floorQuantity,fail};