<template>
  <div class="fixed inset-0 z-50 overflow-y-auto" @keydown.esc="emit('close')">
    <div class="flex min-h-full items-center justify-center p-4">
      <div class="fixed inset-0 bg-black/50" @click="emit('close')"></div>
      <section role="dialog" aria-modal="true" aria-labelledby="okx-title" class="relative w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-gray-800">
        <header class="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div><h3 id="okx-title" class="text-lg font-semibold text-gray-900 dark:text-white">Connect OKX</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Spot crypto · Trading and Funding wallets</p></div>
          <button type="button" class="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close OKX connection" @click="emit('close')">✕</button>
        </header>
        <form id="okx-form" class="space-y-4 p-6" @submit.prevent="submit">
          <div class="rounded-lg bg-green-50 p-4 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
            Create an API key with <strong>Read</strong> permission only. Leave Trade and Withdraw disabled.
            <a href="https://www.okx.com/account/my-api" target="_blank" rel="noopener noreferrer" class="mt-2 block underline">Open OKX API settings</a>
          </div>
          <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{{ error }}</p>
          <div><label for="okx-region" class="label">Account region</label>
            <select id="okx-region" v-model="form.region" class="input"><option value="global">Global / UK</option><option value="eea">European Economic Area</option><option value="us">US / Australia</option></select></div>
          <div><label for="okx-label" class="label">Account label (optional)</label><input id="okx-label" v-model="form.account_label" class="input" maxlength="255" placeholder="My OKX account" /></div>
          <div><label for="okx-key" class="label">API key</label><input id="okx-key" v-model="form.api_key" class="input" type="password" autocomplete="off" maxlength="4096" required /></div>
          <div><label for="okx-secret" class="label">Secret key</label><input id="okx-secret" v-model="form.api_secret" class="input" type="password" autocomplete="off" maxlength="4096" required /></div>
          <div><label for="okx-passphrase" class="label">API passphrase</label><input id="okx-passphrase" v-model="form.passphrase" class="input" type="password" autocomplete="off" maxlength="4096" required />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">The passphrase chosen when creating this API key. All three credentials are encrypted before storage.</p></div>
          <p class="rounded-lg border border-gray-200 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">The first sync downloads balances and up to three months of history privately for reconciliation. Auto-sync becomes available after the holdings and trade history have been checked.</p>
        </form>
        <footer class="flex justify-end gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
          <button type="button" class="btn-secondary" @click="emit('close')">Cancel</button>
          <button type="submit" form="okx-form" class="btn-primary" :disabled="loading || !valid">{{ loading ? 'Checking key…' : 'Connect OKX' }}</button>
        </footer>
      </section>
    </div>
  </div>
</template>
<script setup>
import {computed,reactive} from 'vue'
defineProps({loading:Boolean,error:String})
const emit=defineEmits(['close','save'])
const form=reactive({region:'global',account_label:'',api_key:'',api_secret:'',passphrase:''})
const valid=computed(()=>form.api_key.trim() && form.api_secret.trim() && form.passphrase)
function submit() { if(valid.value) emit('save',{...form,api_key:form.api_key.trim(),api_secret:form.api_secret.trim()}) }
</script>
