<template>
 <section class="card" aria-labelledby="ig-ingestion-heading">
  <div class="card-body space-y-4">
   <div class="flex items-start justify-between gap-3">
    <div><h2 id="ig-ingestion-heading" class="text-lg font-medium text-gray-900 dark:text-white">IG email statements</h2>
     <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">Daily statements collected from your private ingestion folder.</p></div>
    <button class="btn-secondary" :disabled="loading" @click="refresh">Refresh</button>
   </div>
   <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
   <template v-if="data">
    <p class="text-sm text-gray-600 dark:text-gray-300" role="status">{{ data.running || data.source?.running ? 'Processing statements…' : data.enabled ? 'Automatic ingestion enabled' : 'Automatic ingestion not enabled' }}<span v-if="data.source"> · {{ data.source.pending }} files queued</span><span v-if="reviewCount"> · {{ reviewCount }} statements need reconciliation or review</span></p>
    <p v-if="data.source?.lastRun" class="text-xs text-gray-500">Last folder check: {{ format(data.source.lastRun) }}</p>
    <p v-if="data.source?.error" role="alert" class="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">{{ data.source.error }}</p>
    <p v-if="!data.documents.length" class="text-sm text-gray-500">No email statements processed yet.</p>
    <div v-else class="overflow-x-auto">
     <table class="w-full text-left text-sm"><caption class="sr-only">IG statement ingestion results</caption>
      <thead class="border-b border-gray-200 text-gray-500 dark:border-gray-700"><tr><th class="py-2">Account</th><th class="py-2">Statement date</th><th class="py-2">Status</th><th class="py-2">Details</th></tr></thead>
      <tbody class="divide-y divide-gray-100 dark:divide-gray-700"><tr v-for="row in data.documents" :key="row.id">
       <td class="py-3 pr-3">{{ row.account_name || 'Account not identified' }}</td><td class="py-3 pr-3">{{ row.statement_date?.slice(0,10) || 'Unverified' }}</td>
       <td class="py-3 pr-3" :class="row.needsReview || ['review','conflict','rejected'].includes(row.status) ? 'text-amber-600 dark:text-amber-300' : 'text-gray-700 dark:text-gray-300'">{{ row.status === 'imported' && row.needsReview ? 'Valuation imported' : labels[row.status] || row.status }}</td><td class="py-3">{{ row.reason || 'Checks passed' }}</td>
      </tr></tbody>
     </table>
    </div>
   </template>
  </div>
 </section>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import api from '@/services/api'
const data=ref(null),error=ref(''),loading=ref(false)
const reviewCount=computed(()=>data.value?.documents.filter(row=>row.needsReview || ['review','conflict','rejected'].includes(row.status)).length || 0)
const labels={processing:'Processing',imported:'Imported',duplicate:'Already imported',review:'Needs review',conflict:'Conflicting statement',rejected:'Rejected'}
let timer
const format=value=>new Date(value).toLocaleString()
async function refresh(){if(loading.value)return;loading.value=true;try{data.value=(await api.get('/broker-sync/ig-ingestion')).data.data;error.value=''}catch{error.value='Unable to load IG statement status.'}finally{loading.value=false}}
onMounted(()=>{refresh();timer=setInterval(refresh,30000)})
onUnmounted(()=>clearInterval(timer))
</script>
