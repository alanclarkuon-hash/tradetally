<template>
  <section v-if="job || allowUpdate" class="card mb-6 p-4" aria-label="Historical price downloads">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Historical prices</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400" role="status" aria-live="polite">
          <template v-if="job?.status === 'pending'">{{ job.mode==='broker_refresh'?'Saved-price refresh queued':'Queued after broker sync' }}</template>
          <template v-else-if="job?.status === 'processing' && job.stage === 'quotes'">Refreshing saved quotes · {{ job.quoteProcessed }}/{{ job.quoteTotal }} checked</template>
          <template v-else-if="job?.status === 'processing' && job.stage === 'broker_refresh'">Checking broker history for {{ job.currentSymbol }} · {{ job.processed }}/{{ job.total }} assets checked</template>
          <template v-else-if="job?.status === 'processing' && job.stage === 'portfolio'">{{ portfolioLabel }}</template>
          <template v-else-if="job?.status === 'processing' && job.stage === 'calendars'">Checking exchange calendar for {{ job.currentSymbol }} · {{ job.calendarProcessed }}/{{ job.calendarTotal }} listings checked</template>
          <template v-else-if="job?.status === 'processing'">Downloading {{ job.currentSymbol || 'missing prices' }} · {{ job.processed }}/{{ job.total }} assets checked</template>
          <template v-else-if="job?.status === 'failed'">History update needs attention. Saved prices are retained; the next sync retries missing dates.</template>
          <template v-else-if="job?.mode==='broker_refresh'">Price refresh finished · {{ job.processed }}/{{ job.total }} assets checked · {{ job.brokerRows }} broker closes saved · {{ job.gaps.filter(g => !g.unsupported).length }} with dates to review<span v-if="job.gaps.some(g => g.unsupported)"> · {{ job.gaps.filter(g => g.unsupported).length }} unsupported instruments</span></template>
          <template v-else-if="job">Download finished · {{ job.complete }}/{{ job.total }} assets have daily coverage · {{ job.gaps.filter(g => !g.unsupported).length }} with dates to review<span v-if="job.gaps.some(g => g.unsupported)"> · {{ job.gaps.filter(g => g.unsupported).length }} unsupported instruments</span></template>
          <template v-else>Missing history will download after the next broker sync.</template>
        </p>
      </div>
      <button v-if="allowUpdate" type="button" class="btn-secondary text-sm" :disabled="active || requesting" @click="update">{{ requesting ? 'Queuing…' : 'Update history' }}</button>
    </div>
    <p v-if="job?.status==='processing'" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
      {{ heartbeatLabel }}<span v-if="job.lastProgressAt"> · Last progress {{ age(job.lastProgressAt) }}</span>
    </p>
    <div v-if="active" class="mt-3 h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700" role="progressbar"  :aria-label="job.stage==='portfolio'?'Portfolio reconstruction progress':'Assets checked'" :aria-valuenow="progressTotal ? progressNow : undefined" :aria-valuemax="progressTotal || 1" aria-valuemin="0">
      <div class="h-full bg-primary-500 transition-all" :class="{'animate-pulse': !progressTotal}" :style="{width: `${progressTotal ? Math.max(3,progressNow/progressTotal*100) : 8}%`}"></div>
    </div>
    <p v-if="followUp" class="mt-2 text-sm text-gray-600 dark:text-gray-400">One history update is waiting; it starts after this job finishes.</p>
    <p v-if="error" role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <details v-if="job?.gaps.length || job?.portfolioWarnings.length" class="mt-3 text-sm text-gray-600 dark:text-gray-400">
      <summary class="cursor-pointer">Remaining dates and coverage notes</summary>
      <div class="mt-2 max-h-64 overflow-auto">
        <ul class="space-y-2">
          <li v-for="gap in job.gaps" :key="`${gap.instrumentType}:${gap.symbol}`"><strong>{{ gap.symbol }}</strong><template v-if="!gap.unsupported"> · {{ gap.ranges[0]?.from }} to {{ gap.ranges[0]?.to }}</template><p>{{ gap.reason }}</p><details v-if="gap.ranges.length>1"><summary class="cursor-pointer">All {{ gap.ranges.length }} unreturned date ranges</summary><p v-for="range in gap.ranges" :key="range.from">{{ range.from }} to {{ range.to }}</p></details></li>
          <li v-for="warning in job.portfolioWarnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>
    </details>
  </section>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useVisibilityPolling } from '@/composables/useVisibilityPolling'
import api from '@/services/api'
defineProps({ allowUpdate: { type: Boolean, default: false } })
const followUp = ref(null)
const job = ref(null), error = ref(''), requesting = ref(false), observedAt=ref(Date.now())
const active = computed(() => ['pending','processing'].includes(job.value?.status))
const detail=computed(()=>job.value?.portfolioProgress||{})
const age=value=>{const seconds=Math.max(0,Math.floor((observedAt.value-Date.parse(value))/1000));return seconds<60?`${seconds}s ago`:`${Math.floor(seconds/60)}m ago`}
const heartbeatLabel=computed(()=>!job.value?.lastHeartbeatAt?'Waiting for worker feedback':
 observedAt.value-Date.parse(job.value.lastHeartbeatAt)>90000?`No recent worker check-in · last seen ${age(job.value.lastHeartbeatAt)}`:`Worker checked in ${age(job.value.lastHeartbeatAt)}`)
const portfolioLabel=computed(()=>{
 const p=detail.value,account=p.accountName?`${p.accountName} · `:'',counts=p.accountTotal?` · ${p.accountProcessed}/${p.accountTotal} accounts finished`:''
 const labels={waiting:'Waiting for earlier portfolio reconstruction',account:'Reading account history',fx:'Loading historical exchange rates',reconstructing:'Reconstructing account history',prices:`Checking ${p.currentSymbol||'historical prices'} · ${p.processed||0}/${p.total||0} assets`,values:`Calculating daily values · ${p.processed||0}/${p.total||0} dates`,saving:`Saving ${p.total||0} daily values`,account_complete:'Account history checked',capture:'Saving current portfolio values'}
 return account+(labels[p.stage]||'Updating portfolio history from downloaded prices')+counts
})
const progressNow=computed(()=>job.value?.stage==='portfolio'?detail.value.processed||0:job.value?.stage==='calendars'?job.value.calendarProcessed:job.value?.stage==='quotes'?job.value.quoteProcessed:job.value?.processed||0)
const progressTotal=computed(()=>job.value?.stage==='portfolio'?(['prices','values'].includes(detail.value.stage)?detail.value.total||0:0):job.value?.stage==='calendars'?job.value.calendarTotal:job.value?.stage==='quotes'?job.value.quoteTotal:job.value?.total||0)
let mounted = false
async function poll() {
  observedAt.value=Date.now()
  try {
    const response = await api.get('/broker-sync/history/status')
    if (mounted) {const jobs=response.data.data||[];job.value=jobs.find(j=>j.status==='processing')||jobs[0]||null;followUp.value=jobs.find(j=>j.status==='pending'&&j.id!==job.value?.id)||null;}
  } catch { /* Do not turn an optional progress poll into a page error. */ }
}
const polling = useVisibilityPolling(poll, computed(() => active.value ? 5000 : 30000), { immediate: true })
async function update() {
  requesting.value = true; error.value = ''
  try {
    await api.post('/broker-sync/history/update')
    await poll()
  } catch { error.value = 'Could not queue history update. Please try again.' }
  finally { requesting.value = false }
}
onMounted(() => { mounted = true; polling.start() })
onUnmounted(() => { mounted = false; polling.stop() })
</script>
