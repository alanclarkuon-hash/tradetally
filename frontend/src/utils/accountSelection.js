// Keep the existing comma-separated API contract. An explicit empty marker
// must remain distinct from null/blank, which mean no filtering.
export const EMPTY_ACCOUNTS='__none__'
export const UNSORTED_ACCOUNT='__unsorted__'
export function accountSelection(value) {
  if(value==null||value==='')return null
  if(value===EMPTY_ACCOUNTS)return []
  return [...new Set((Array.isArray(value)?value:String(value).split(',')).map(v=>String(v).trim()).filter(v=>v&&v!==EMPTY_ACCOUNTS))]
}
export function matchesAccount(selection,identifier) {
  const values=accountSelection(selection)
  return values===null||values.includes(identifier||UNSORTED_ACCOUNT)
}
export function singleAccount(selection) {
  const values=accountSelection(selection)
  return values?.length===1&&values[0]!==UNSORTED_ACCOUNT?values[0]:''
}
