// Project original broker settlements onto matched records for reporting only.
const {originalSettlementReports,projectOriginalReports}=require('./planBrokerFills');
function reportingSettlements(groups) {
 const {legacy,canonical}=originalSettlementReports(groups);
 return projectOriginalReports(groups,legacy,canonical);
}
module.exports={reportingSettlements};
