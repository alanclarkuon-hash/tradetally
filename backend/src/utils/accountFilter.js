// Values are always bound parameters; column names are trusted call-site SQL.
// Preserve the legacy unfiltered [] contract. The UI sends __none__ for an
// explicit empty selection so it cannot silently become All Accounts.
function accountPredicate(accounts,params,column='t.account_identifier',index=params.length+1) {
  if(!accounts?.length)return 'TRUE';
  if(accounts.includes('__none__'))return 'FALSE';
  const named=accounts.filter(a=>a!=='__unsorted__');
  const conditions=[];
  if(named.length){params.push(named);conditions.push(`${column} = ANY($${index}::text[])`);}
  if(accounts.includes('__unsorted__'))conditions.push(`${column} IS NULL OR ${column} = ''`);
  return conditions.length===1&&!accounts.includes('__unsorted__')?conditions[0]:`(${conditions.join(' OR ')})`;
}
module.exports={accountPredicate};
