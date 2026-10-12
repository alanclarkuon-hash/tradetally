function accountIds(d){return [...new Set([d.accountId,...(d.accountIds||[])].filter(Boolean))]}
function stageAccount(d,action,key){const rows=action==='entry'?d.entries:d.exits;return rows?.find(r=>r.key===key)?.accountId||d.accountId}
module.exports={accountIds,stageAccount};
