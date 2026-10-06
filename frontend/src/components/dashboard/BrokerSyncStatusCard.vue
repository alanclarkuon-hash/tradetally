<template>
  <section class="card-dense p-5" aria-labelledby="broker-status-title">
    <div class="flex items-center justify-between gap-4 mb-4">
      <div><h2 id="broker-status-title" class="heading-card">Broker sync status</h2><p class="text-sm text-gray-500 dark:text-gray-400">All brokers · {{ timezoneLabel }}</p></div>
      <button class="text-sm text-primary-600 dark:text-primary-400" :disabled="loading" @click="load">Refresh status</button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-if="loading && !rows.length" role="status" class="text-sm text-gray-500">Loading sync status…</p>
    <ul v-else class="divide-y divide-gray-200 dark:divide-gray-700">
      <li v-for="row in rows" :key="row.id" class="py-3">
        <div class="flex flex-wrap justify-between gap-2"><strong class="text-sm text-gray-900 dark:text-white">{{ labels[row.broker] || row.broker }}</strong><span class="text-sm" :class="row.status==='failed' ? 'text-red-600 dark:text-red-400' : row.status==='warning' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'">{{ statuses[row.status] || row.status }}</span></div>
        <p v-if="row.status!=='manual'" class="text-sm text-gray-600 dark:text-gray-400">Last successful sync: {{ row.lastSuccessfulSyncAt ? formatDateTime(row.lastSuccessfulSyncAt) : 'No successful sync recorded' }}</p>
        <p v-if="row.lastAttemptAt" class="text-xs text-gray-500 dark:text-gray-400">Latest attempt: {{ formatDateTime(row.lastAttemptAt) }}</p>
        <p v-if="row.failure" class="text-sm mt-1" :class="recovered(row) ? 'text-gray-500 dark:text-gray-400' : 'text-amber-700 dark:text-amber-400'">{{ recovered(row) ? 'Previous failure (subsequent sync succeeded)' : 'Last failure' }} · {{ formatDateTime(row.lastFailureAt) }}: {{ row.failure }}</p>
      </li>
    </ul>
    <p v-if="!loading && !error && !rows.length" class="text-sm text-gray-500">No broker connections or statement accounts.</p>
    <RouterLink to="/broker-sync" class="inline-block mt-4 text-sm text-primary-600 dark:text-primary-400">Manage broker syncs</RouterLink>
  </section>
</template>
<script setup>
import {ref,onMounted,onUnmounted} from 'vue'
import api from '@/services/api'
import {useUserTimezone} from '@/composables/useUserTimezone'
const {formatDateTime,timezoneLabel}=useUserTimezone()
const rows=ref([]),loading=ref(false),error=ref('')
const labels={ibkr:'IBKR',trading212:'Trading 212',kraken:'Kraken',okx:'OKX',etoro:'eToro',ig:'IG',schwab:'Schwab'}
const statuses={success:'Successful',completed:'Completed',failed:'Failed',warning:'Completed with warnings',running:'Running',never:'Not synced',manual:'Statement imports · no API sync'}
const recovered=row=>Date.parse(row.lastSuccessfulSyncAt)>Date.parse(row.lastFailureAt)
let timer,disposed=false
async function load(){
  if(loading.value)return
  loading.value=true
  try{const response=await api.get('/broker-sync/status-summary');if(!disposed){rows.value=response.data.data||[];error.value=''}}
  catch{if(!disposed)error.value='Sync status is unavailable. Try refreshing status.'}
  finally{loading.value=false}
}
onMounted(()=>{load();timer=setInterval(load,30000)})
onUnmounted(()=>{disposed=true;clearInterval(timer)})
</script>
