<template>
  <section v-if="failure" class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-red-600 px-4 py-3 text-white sm:px-6" role="alert" aria-live="assertive" aria-label="Backup failure">
    <div class="flex items-start gap-3">
      <ExclamationTriangleIcon class="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        <p class="text-sm font-semibold">Backup failed<span v-if="failedAtLabel" class="font-normal"> · {{ failedAtLabel }}</span></p>
        <p class="mt-0.5 text-sm">Check the failure and retry the backup. This warning clears after a successful backup.</p>
      </div>
    </div>
    <RouterLink to="/admin/backups" class="shrink-0 rounded border border-white/60 px-3 py-1.5 text-sm font-semibold hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Review backups</RouterLink>
  </section>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
import { useAuthStore } from '@/stores/auth'
import { useVisibilityPolling } from '@/composables/useVisibilityPolling'
import api from '@/services/api'

const auth = useAuthStore()
const adminId = computed(() => auth.isAuthenticated && auth.user?.role === 'admin' ? auth.user.id : null)
const failure = ref(null)
let generation = 0
const failedAtLabel = computed(() => {
  const value = Date.parse(failure.value?.failedAt)
  return Number.isFinite(value) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value) : ''
})
async function checkStatus() {
  const id = adminId.value, requestGeneration = generation
  if (!id) return
  try {
    const response = await api.get('/admin/backup/failure-status')
    if (generation !== requestGeneration || adminId.value !== id) return
    if (response.data.failed === true) failure.value = { failedAt: response.data.failedAt }
    else if (response.data.failed === false) failure.value = null
  } catch {
    // A failed poll is not proof of recovery: keep any known warning visible.
  }
}
const polling = useVisibilityPolling(checkStatus, 60000, { immediate: true })
watch(adminId, id => {
  generation++
  failure.value = null
  polling.stop()
  if (id) polling.start()
}, { immediate: true, flush: 'sync' })
onUnmounted(() => { generation++; polling.stop() })
</script>