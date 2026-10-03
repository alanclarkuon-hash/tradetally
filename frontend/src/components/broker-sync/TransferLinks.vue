<template>
  <section v-if="error || data?.matches.length || data?.unmatched.length" class="card" aria-labelledby="transfer-links-title">
    <div class="card-body space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h2 id="transfer-links-title" class="text-lg font-medium text-gray-900 dark:text-white">Transfers between brokers</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">Your coins moving between accounts, with withdrawal fees shown separately.</p>
        </div>
        <button type="button" class="btn-secondary" :disabled="loading" @click="load">Refresh</button>
      </div>
      <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      <template v-if="data">
        <div v-if="data.matches.length" class="overflow-x-auto">
          <table class="w-full text-sm text-left">
            <caption class="sr-only">Transfers matched by unique coin amount and timing</caption>
            <thead class="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr><th scope="col" class="py-2 pr-4">Date</th><th scope="col" class="py-2 pr-4">Route</th><th scope="col" class="py-2 pr-4 text-right">Received</th><th scope="col" class="py-2 text-right">Withdrawal fee</th></tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800 text-gray-900 dark:text-gray-100">
              <tr v-for="row in data.matches" :key="row.id">
                <td class="py-3 pr-4 whitespace-nowrap">{{ row.sent_at.slice(0, 10) }}</td>
                <td class="py-3 pr-4 whitespace-nowrap">{{ label(row.source_broker) }} → {{ label(row.destination_broker) }}</td>
                <td class="py-3 pr-4 text-right tabular-nums whitespace-nowrap">{{ amount(row.quantity) }} {{ row.asset }}</td>
                <td class="py-3 text-right tabular-nums whitespace-nowrap">{{ amount(row.source_fee) }} {{ row.asset }}</td>
              </tr>
            </tbody>
          </table>
          <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">Matched by unique amount and timing. Blockchain transaction IDs have not been independently verified.</p>
        </div>
        <details v-if="data.unmatched.length" class="border-t border-gray-200 dark:border-gray-700 pt-3">
          <summary class="cursor-pointer text-sm font-medium text-gray-900 dark:text-white">{{ data.unmatched.length }} movements still need a source or destination</summary>
          <ul class="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li v-for="(row, index) in data.unmatched" :key="index">{{ row.date.slice(0, 10) }} · {{ label(row.broker) }} · {{ row.direction === 'in' ? 'Received' : 'Sent' }} {{ amount(row.quantity) }} {{ row.asset }}</li>
          </ul>
        </details>
        <p class="text-sm text-gray-600 dark:text-gray-400">{{ data.notice }}</p>
      </template>
    </div>
  </section>
</template>

<script setup>
import {ref, onMounted, watch} from 'vue'
import api from '@/services/api'
const props = defineProps({revision: {type: String, default: ''}})
const data = ref(null), loading = ref(false), error = ref('')
const label = broker => ({kraken: 'Kraken', okx: 'OKX', etoro: 'eToro'}[broker] || broker)
const amount = value => String(value).includes('.') ? String(value).replace(/0+$/, '').replace(/\.$/, '') : String(value)
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try { data.value = (await api.get('/broker-sync/transfers')).data }
  catch { error.value = 'Transfer records could not be loaded. Refresh to try again.' }
  finally { loading.value = false }
}
onMounted(load)
watch(() => props.revision, load)
</script>
