<template>
  <section class="card" aria-labelledby="ig-files-heading">
    <div class="card-body space-y-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400">IG · statement imports</p>
          <h2 id="ig-files-heading" class="mt-1 text-lg font-medium text-gray-900 dark:text-white">Update your IG accounts</h2>
          <p class="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">Choose the accounts to update. Upload full reports, or reconcile a share account’s Transactions CSV using saved statements.</p>
        </div>
        <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">File imports only</span>
      </div>
      <p v-if="loading" role="status" class="text-sm text-gray-500">Loading IG accounts…</p>
      <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{{ error }}</p>
      <p v-if="success" role="status" class="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">{{ success }}</p>
      <form v-if="accounts.length" class="space-y-4" @submit.prevent="previewFiles">
        <fieldset :disabled="!!busy" class="space-y-3">
          <legend class="sr-only">Accounts and statement files</legend>
          <div v-for="account in accounts" :key="account.id" class="rounded-lg border border-gray-200 dark:border-gray-700">
            <label class="flex cursor-pointer items-center gap-3 p-4">
              <input v-model="selected" type="checkbox" :value="account.id" class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" @change="invalidate" />
              <span class="flex-1 text-sm font-medium text-gray-900 dark:text-white">{{ account.name }}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ account.kind === 'spread_bet' ? 'Spread betting' : 'Share dealing' }} · GBP</span>
            </label>
            <div v-if="selected.includes(account.id)" class="grid gap-4 border-t border-gray-200 p-4 dark:border-gray-700 sm:grid-cols-2">
              <label v-if="account.csvReconciliation" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 sm:col-span-2">
                <input v-model="csvOnlyAccounts" type="checkbox" :value="account.id" @change="invalidate" /> Reconcile Transactions CSV using saved statements
              </label>
              <p v-if="csvOnlyAccounts.includes(account.id)" class="text-xs text-gray-500 sm:col-span-2">Full-history or incremental exports are accepted. Existing records are retained; balances must match the saved statements. New trades may need their execution PDFs.</p>
              <div v-for="field in fieldsFor(account)" :key="field">
                <label :for="`${account.id}-${field}`" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{{ labels[field] }}</label>
                <input :id="`${account.id}-${field}`" type="file" :accept="pdfFields.includes(field) ? '.pdf' : '.csv'" :required="!dailyOnly(account)" class="block w-full rounded-md border border-gray-200 text-sm text-gray-600 file:mr-3 file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium dark:border-gray-700 dark:text-gray-300 dark:file:bg-gray-800 dark:file:text-gray-200" @change="choose(account.id,field,$event)" />
              </div>
              <div v-if="account.kind === 'share_dealing' && !csvOnlyAccounts.includes(account.id)" class="sm:col-span-2">
                <label :for="`${account.id}-execution`" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Earlier trade statements (optional)</label>
                <input :id="`${account.id}-execution`" type="file" accept=".pdf" multiple class="block w-full text-sm text-gray-600 dark:text-gray-300" @change="chooseEvidence(account.id,$event)" />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Add the trade-day PDFs if the latest balance statement does not show those purchases or sales. You can select several files.</p>
              </div>
              <div v-if="account.kind === 'spread_bet'" class="sm:col-span-2">
                <label :for="`${account.id}-daily`" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Daily portfolio statements (optional)</label>
                <input :id="`${account.id}-daily`" type="file" accept=".pdf" multiple class="block w-full text-sm text-gray-600 dark:text-gray-300" @change="chooseDaily(account.id,$event)" />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Add daily PDFs to backfill balances and open-position P&amp;L. For dates already covered by your cash history, these can be uploaded on their own. Newer dates need updated CSV exports and monthly PDFs alongside them.</p>
              </div>
            </div>
          </div>
        </fieldset>
        <p class="text-xs text-gray-500 dark:text-gray-400">If money moved between IG accounts, include updated reports for both accounts. Up to 5 MB per file. Files are processed privately on your TradeTally server.</p>
        <button type="submit" class="btn-secondary" :disabled="busy || !selected.length">{{ busy === 'preview' ? 'Checking statements…' : busy === 'apply' ? 'Backing up and importing…' : automaticCsv ? 'Reconcile and import CSV' : 'Preview import' }}</button>
      </form>
      <div v-if="preview" class="space-y-4 border-t border-gray-200 pt-5 dark:border-gray-700" aria-live="polite">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-medium text-gray-900 dark:text-white">Balance checks passed</h3>
          <span class="text-xs font-medium text-green-700 dark:text-green-400">Ready to import</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <caption class="sr-only">Accounts included in the IG update</caption>
            <thead class="border-b border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"><tr><th scope="col" class="pb-2">Account</th><th scope="col" class="pb-2 text-right">Latest cash</th><th scope="col" class="pb-2 text-right">Closed portions</th><th scope="col" class="pb-2 text-right">Holdings</th></tr></thead>
            <tbody class="divide-y divide-gray-100 text-gray-900 dark:divide-gray-800 dark:text-gray-200"><tr v-for="account in preview.accounts" :key="account.name"><td class="py-3 pr-4">{{ account.name }}</td><td class="py-3 text-right tabular-nums">{{ money(account.cash) }}</td><td class="py-3 text-right tabular-nums">{{ account.closedTrades }}</td><td class="py-3 text-right tabular-nums">{{ account.holdings }}</td></tr></tbody>
          </table>
        </div>
        <p class="text-sm text-gray-600 dark:text-gray-400">{{ preview.importedTrades }} new trade or holding records · {{ preview.importedEvents }} new cash events · {{ preview.transfers }} internal transfers linked across your accounts.</p>
        <p v-if="preview.updatedOpenPositions || preview.closedOpenPositions" class="text-sm text-gray-600 dark:text-gray-400">{{ preview.updatedOpenPositions || 0 }} remaining spread-bet stakes updated · {{ preview.closedOpenPositions || 0 }} positions now fully closed.</p>
        <p v-if="preview.updatedSharePositions" class="text-sm text-gray-600 dark:text-gray-400">{{ preview.updatedSharePositions }} existing share lots updated from verified purchase details.</p>
        <p v-if="preview.portfolioDates" class="text-sm text-gray-600 dark:text-gray-400">{{ preview.portfolioDates }} dated portfolio values checked for the chart.</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ preview.notice }} A private database backup is taken before importing. Existing matching records are skipped.</p>
        <button type="button" class="btn-primary" :disabled="!!busy" @click="apply">{{ busy === 'apply' ? 'Backing up and importing…' : 'Import checked reports' }}</button>
      </div>
    </div>
  </section>
</template>

<script setup>
import {ref,reactive,computed,onMounted} from 'vue'
import api from '@/services/api'
const accounts=ref([]),selected=ref([]),loading=ref(true),busy=ref(''),error=ref(''),success=ref(''),preview=ref(null)
const csvOnlyAccounts=ref([])
const automaticCsv=computed(()=>selected.value.length>0&&selected.value.every(id=>csvOnlyAccounts.value.includes(id)))
const fieldsFor=account=>csvOnlyAccounts.value.includes(account.id)?['transactions']:account.required
const files=reactive(new Map()),evidenceFiles=new Map(),dailyFiles=ref(new Map()),pdfFields=['trading','ledger']
const labels={transactions:'Transactions CSV',activity:'Past activity CSV',breakdown:'P&L Breakdown CSV',trading:'Trading / balance statement PDF',ledger:'Monthly ledger statement PDF'}
const money=value=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(value)
const message=e=>e.response?.data?.message || 'The upload could not finish. Please try again.'
function invalidate(){preview.value=null;error.value='';success.value=''}
function choose(id,field,event){invalidate();const key=`${id}:${field}`,file=event.target.files?.[0];if(file)files.set(key,file);else files.delete(key)}
function chooseEvidence(id,event){invalidate();evidenceFiles.set(id,Array.from(event.target.files||[]))}
function chooseDaily(id,event){invalidate();dailyFiles.value.set(id,Array.from(event.target.files||[]))}
function dailyOnly(account){return account.kind==='spread_bet'&&(dailyFiles.value.get(account.id)||[]).length>0&&!account.required.some(field=>files.has(`${account.id}:${field}`))}
async function previewFiles(){
  invalidate();const form=new FormData()
  for(const account of accounts.value.filter(a=>selected.value.includes(a.id)))for(const field of dailyOnly(account)?[]:fieldsFor(account)){
    const file=files.get(`${account.id}:${field}`)
    if(!file){error.value=`Please include ${labels[field]} for ${account.name}.`;return}
    if(file.size>5*1024*1024){error.value='Each file must be 5 MB or smaller.';return}
    form.append(`${account.id}:${field}`,file)
  }
  for(const id of selected.value.filter(id=>!csvOnlyAccounts.value.includes(id)))for(const file of evidenceFiles.get(id)||[]) {
    if(file.size>5*1024*1024){error.value='Each file must be 5 MB or smaller.';return}
    form.append(`${id}:execution`,file)
  }
  for(const id of selected.value)for(const file of dailyFiles.value.get(id)||[]) {
    if(file.size>5*1024*1024){error.value='Each file must be 5 MB or smaller.';return}
    form.append(`${id}:daily`,file)
  }
  const autoApply=automaticCsv.value
  busy.value='preview'
  try{preview.value=(await api.post('/broker-sync/ig-files/preview',form,{timeout:180000})).data.data}
  catch(e){error.value=message(e)}finally{busy.value=''}
  if(autoApply&&preview.value)await apply()
}
async function apply(){
  if(!preview.value||busy.value)return
  busy.value='apply';error.value=''
  try{const result=(await api.post('/broker-sync/ig-files/apply',{token:preview.value.token},{timeout:180000})).data.data
    success.value=`Import finished: ${result.importedTrades} new trade or holding records and ${result.importedEvents} new cash events. ${result.updatedOpenPositions || 0} open stakes and ${result.updatedSharePositions || 0} share lots updated; ${result.closedOpenPositions || 0} positions fully closed. Your balances are reconciled. Portfolio statement values saved. ${(result.portfolioHistory?.warnings||[]).join(' ')}`;preview.value=null}
  catch(e){error.value=message(e)}finally{busy.value=''}
}
onMounted(async()=>{try{accounts.value=(await api.get('/broker-sync/ig-files/accounts')).data.data}catch(e){error.value=message(e)}finally{loading.value=false}})
</script>
