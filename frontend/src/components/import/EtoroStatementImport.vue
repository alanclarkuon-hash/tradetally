<template>
  <section aria-labelledby="etoro-statement-heading" class="space-y-5 border-t border-gray-200 pt-5 dark:border-gray-700">
    <div>
      <p class="text-xs font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400">eToro · USD investment account</p>
      <h2 id="etoro-statement-heading" class="mt-1 text-lg font-medium text-gray-900 dark:text-white">Update cashflow &amp; income</h2>
      <p class="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">Download your account statement from eToro as XLSX. Choose a start date on or before your last imported statement date so we can match the overlap.</p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Trades and current holdings continue through Broker Sync. This upload updates cash movements, dividends, interest, fees and taxes.</p>
    </div>
    <p v-if="loading" role="status" class="text-sm text-gray-500">Loading your eToro accounts…</p>
    <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{{ error }}</p>
    <p v-if="success" role="status" class="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">{{ success }}</p>
    <p v-if="!loading && !accounts.length && !error" class="text-sm text-gray-600 dark:text-gray-400">Configure a managed eToro USD account and its initial statement history before updating here.</p>
    <form v-if="accounts.length" class="space-y-4" @submit.prevent="check">
      <fieldset :disabled="!!busy" class="grid gap-4 sm:grid-cols-2">
        <legend class="sr-only">Account and eToro statement</legend>
        <div>
          <label for="etoro-statement-account" class="label">eToro account</label>
          <select id="etoro-statement-account" v-model="accountId" class="input" required @change="invalidate">
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <p class="mt-1 text-xs text-gray-500">Last statement through {{ accounts.find(a => a.id === accountId)?.through }}.</p>
        </div>
        <div>
          <label for="etoro-statement-file" class="label">Account statement XLSX</label>
          <input id="etoro-statement-file" type="file" accept=".xlsx" required class="block w-full rounded-md border border-gray-200 text-sm text-gray-600 file:mr-3 file:border-0 file:bg-gray-100 file:px-3 file:py-2 dark:border-gray-700 dark:text-gray-300 dark:file:bg-gray-800" @change="choose" />
          <p class="mt-1 text-xs text-gray-500">Up to 10 MB. The workbook is processed privately and is not retained.</p>
        </div>
      </fieldset>
      <button type="submit" class="btn-secondary" :disabled="!!busy">{{ busy === 'preview' ? 'Checking statement…' : 'Preview statement' }}</button>
    </form>
    <div v-if="preview" class="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700" aria-live="polite">
      <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-medium text-gray-900 dark:text-white">Statement checked · through {{ preview.through }}</h3><span class="text-sm font-medium text-green-700 dark:text-green-400">Cash reconciles</span></div>
      <dl class="grid gap-4 sm:grid-cols-3">
        <div><dt class="text-sm text-gray-500">Previous statement cash</dt><dd class="mt-1 text-lg font-medium tabular-nums">{{ money(preview.previousCash) }}</dd></div>
        <div><dt class="text-sm text-gray-500">Closing statement cash</dt><dd class="mt-1 text-lg font-medium tabular-nums">{{ money(preview.closingCash) }}</dd></div>
        <div><dt class="text-sm text-gray-500">New dividends &amp; interest</dt><dd class="mt-1 text-lg font-medium tabular-nums">{{ money(preview.newIncome) }}</dd></div>
      </dl>
      <p class="text-sm text-gray-600 dark:text-gray-400">{{ preview.newRecords }} new activity entries · {{ preview.matchedRecords }} already recorded.</p>
      <p class="text-sm text-gray-600 dark:text-gray-400">New deposits {{ money(preview.newDeposits) }} · withdrawals {{ money(preview.newWithdrawals) }} · fees &amp; taxes {{ money(preview.newFees) }}.</p>
      <p class="text-xs text-gray-500 dark:text-gray-400">Existing matching entries are retained. A private database backup is taken before applying. This preview expires after 15 minutes.</p>
      <button type="button" class="btn-primary" :disabled="!!busy" @click="apply">{{ busy === 'apply' ? 'Backing up and updating…' : 'Apply statement update' }}</button>
    </div>
  </section>
</template>
<script setup>
import {onMounted,ref} from 'vue'
import api from '@/services/api'
const accounts=ref([]),accountId=ref(''),file=ref(null),preview=ref(null),loading=ref(true),busy=ref(''),error=ref(''),success=ref('')
const money=v=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'USD'}).format(v)
const message=e=>e.response?.data?.message||'The statement update could not finish. Please try again.'
function invalidate(){preview.value=null;error.value='';success.value=''}
function choose(e){invalidate();file.value=e.target.files?.[0]||null}
async function check(){
  invalidate();if(!file.value||!file.value.name.toLowerCase().endsWith('.xlsx')){error.value='Choose the XLSX account statement downloaded from eToro.';return}
  if(file.value.size>10*1024*1024){error.value='Choose a statement of 10 MB or less.';return}
  const form=new FormData();form.append('accountId',accountId.value);form.append('statement',file.value);busy.value='preview'
  try{preview.value=(await api.post('/broker-sync/etoro-statements/preview',form,{timeout:180000})).data.data}catch(e){error.value=message(e)}finally{busy.value=''}
}
async function apply(){
  if(!preview.value||busy.value)return
  busy.value='apply';error.value=''
  try{const r=(await api.post('/broker-sync/etoro-statements/apply',{token:preview.value.token},{timeout:180000})).data.data
    success.value=`Updated through ${r.through}: ${r.newRecords} new activity entries. Closing cash ${money(r.closingCash)}. No trade records were added.`
    const a=accounts.value.find(a=>a.id===accountId.value);if(a)a.through=r.through;preview.value=null
  }catch(e){error.value=message(e)}finally{busy.value=''}
}
onMounted(async()=>{try{accounts.value=(await api.get('/broker-sync/etoro-statements/accounts')).data.data;accountId.value=accounts.value[0]?.id||''}catch(e){error.value=message(e)}finally{loading.value=false}})
</script>
