<template>
  <section v-if="job || allowUpdate" class="card mb-6 p-4" aria-label="Historical price downloads">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Historical prices</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400" role="status" aria-live="polite">
          <template v-if="job?.status === 'pending'">Queued after broker sync</template>
          <template v-else-if="job?.status === 'processing' && job.stage === 'portfolio'">Updating portfolio history from downloaded prices</template>
          <template v-else-if="job?.status === 'processing' && job.stage === 'calendars'">Checking exchange calendar for {{ job.currentSymbol }} · {{ job.calendarProcessed }}/{{ job.calendarTotal }} listings checked</template>
          <template v-else-if="job?.status === 'processing'">Downloading {{ job.currentSymbol || 'missing prices' }} · {{ job.processed }}/{{ job.total }} assets checked</template>
          <template v-else-if="job?.status === 'failed'">History update needs attention. Saved prices are retained; the next sync retries missing dates.</template>
          <template v-else-if="job">Download finished · {{ job.complete }}/{{ job.total }} assets have daily coverage · {{ job.gaps.length }} with dates to review</template>
          <template v-else>Missing history will download after the next broker sync.</template>
        </p>
      </div>
      <button v-if="allowUpdate" type="button" class="btn-secondary text-sm" :disabled="active || requesting" @click="update">{{ requesting ? 'Queuing…' : 'Update history' }}</button>
    </div>
    <div v-if="active" class="mt-3 h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700" role="progressbar" aria-label="Assets checked" :aria-valuenow="job.processed" :aria-valuemax="job.total || 1" aria-valuemin="0">
      <div class="h-full bg-primary-500 transition-all" :class="{'animate-pulse': !job.total || job.stage === 'portfolio'}" :style="{width: `${job.total ? Math.max(3,job.processed/job.total*100) : 8}%`}"></div>
    </div>
    <p v-if="error" role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <details v-if="job?.gaps.length || job?.portfolioWarnings.length" class="mt-3 text-sm text-gray-600 dark:text-gray-400">
      <summary class="cursor-pointer">Remaining dates and coverage notes</summary>
      <div class="mt-2 max-h-64 overflow-auto">
        <ul class="space-y-2">
          <li v-for="gap in job.gaps" :key="`${gap.instrumentType}:${gap.symbol}`"><strong>{{ gap.symbol }}</strong> · {{ gap.ranges[0]?.from }} to {{ gap.ranges[0]?.to }}<p>{{ gap.reason }}</p><details v-if="gap.ranges.length>1"><summary class="cursor-pointer">All {{ gap.ranges.length }} unreturned date ranges</summary><p v-for="range in gap.ranges" :key="range.from">{{ range.from }} to {{ range.to }}</p></details></li>
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
const job = ref(null), error = ref(''), requesting = ref(false)
const active = computed(() => ['pending','processing'].includes(job.value?.status))
let mounted = false
async function poll() {
  try {
    const response = await api.get('/broker-sync/history/status')
    if (mounted) job.value = response.data.data?.[0] || null
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
