<template>
  <div class="fixed inset-0 z-50 overflow-y-auto" @keydown.esc="emit('close')">
    <div class="flex min-h-full items-center justify-center p-4">
      <div class="fixed inset-0 bg-black/50" @click="emit('close')"></div>
      <section role="dialog" aria-modal="true" aria-labelledby="kraken-title" class="relative w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-gray-800">
        <header class="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div><h3 id="kraken-title" class="text-lg font-semibold text-gray-900 dark:text-white">Connect Kraken</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Spot crypto and staking · Read only</p></div>
          <button type="button" class="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close Kraken connection" @click="emit('close')">✕</button>
        </header>
        <form id="kraken-form" class="space-y-4 p-6" @submit.prevent="submit">
          <div class="rounded-lg bg-green-50 p-4 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
            Create a dedicated API key with these permissions:
            <ul class="mt-2 list-disc space-y-1 pl-5"><li>Query Funds</li><li>Query Open Orders &amp; Trades</li><li>Query Closed Orders &amp; Trades</li><li>Query Ledger Entries</li></ul>
            <p class="mt-2">Leave all other permissions disabled, including trading, withdrawals, Earn and WebSocket. Staking balances and rewards use the query permissions above.</p>
            <a href="https://pro.kraken.com/app/settings/api" target="_blank" rel="noopener noreferrer" class="mt-2 block underline">Open Kraken API settings</a>
          </div>
          <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{{ error }}</p>
          <div><label for="kraken-label" class="label">Account label (optional)</label><input id="kraken-label" v-model="form.account_label" class="input" maxlength="255" placeholder="My Kraken account" /></div>
          <div><label for="kraken-key" class="label">API key</label><input id="kraken-key" v-model="form.api_key" class="input" type="password" autocomplete="off" maxlength="4096" required /></div>
          <div><label for="kraken-secret" class="label">Private key / API secret</label><input id="kraken-secret" v-model="form.api_secret" class="input" type="password" autocomplete="off" maxlength="4096" required />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Both credentials are encrypted before storage. Enter them here rather than in chat.</p></div>
          <p class="text-sm text-gray-600 dark:text-gray-300">Leave Query Start/End Date unset and Custom nonce window at 0. Use this key only for TradeTally. API-key two-factor authentication is not supported for scheduled syncs.</p>
          <p class="rounded-lg border border-gray-200 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">The first sync downloads balances, spot trades, staking allocations and ledger history privately. Reports and auto-sync become available after the data has been reconciled.</p>
        </form>
        <footer class="flex justify-end gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
          <button type="button" class="btn-secondary" @click="emit('close')">Cancel</button>
          <button type="submit" form="kraken-form" class="btn-primary" :disabled="loading || !valid">{{ loading ? 'Checking key…' : 'Connect Kraken' }}</button>
        </footer>
      </section>
    </div>
  </div>
</template>
<script setup>
import {computed,reactive} from 'vue'
defineProps({loading:Boolean,error:String})
const emit=defineEmits(['close','save'])
const form=reactive({account_label:'',api_key:'',api_secret:''})
const valid=computed(()=>form.api_key.trim() && form.api_secret.trim())
function submit() { if(valid.value) emit('save',{...form,api_key:form.api_key.trim(),api_secret:form.api_secret.trim()}) }
</script>
