<template>
  <div class="fixed inset-0 z-50 overflow-y-auto" @keydown.esc="emit('close')">
    <div class="flex min-h-full items-center justify-center p-4">
      <div class="fixed inset-0 bg-black/50" @click="emit('close')"></div>
      <section role="dialog" aria-modal="true" aria-labelledby="ig-title" class="relative w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-gray-800">
        <header class="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div><h3 id="ig-title" class="text-lg font-semibold text-gray-900 dark:text-white">Connect IG spread betting</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Account and history downloads</p></div>
          <button type="button" class="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close IG connection" @click="emit('close')">✕</button>
        </header>
        <form id="ig-form" class="space-y-4 p-6" @submit.prevent="submit">
          <div class="rounded-lg bg-red-50 p-4 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
            Generate an API key in IG’s web platform: My Account → Settings → API Keys.
            <a href="https://labs.ig.com/gettingstarted" target="_blank" rel="noopener noreferrer" class="mt-2 block underline">IG API setup instructions</a>
            <p class="mt-2">IG also requires your login username and password. Its API access permits trading; TradeTally restricts this connector to login and data downloads. All three credentials are encrypted before storage.</p>
          </div>
          <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{{ error }}</p>
          <div><label for="ig-environment" class="label">Environment</label><select id="ig-environment" v-model="form.broker_environment" class="input"><option value="live">Live account</option><option value="demo">Demo account</option></select></div>
          <div><label for="ig-key" class="label">API key</label><input id="ig-key" v-model="form.api_key" class="input" type="password" autocomplete="off" maxlength="4096" required /></div>
          <div><label for="ig-username" class="label">IG username</label><input id="ig-username" v-model="form.username" class="input" type="password" autocomplete="off" maxlength="30" required />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Use your IG login identifier, not your email address. Enter credentials here rather than in chat.</p></div>
          <div><label for="ig-password" class="label">IG password</label><input id="ig-password" v-model="form.password" class="input" type="password" autocomplete="off" maxlength="350" required /></div>
          <div><label for="ig-account" class="label">Spread-betting account ID (optional)</label><input id="ig-account" v-model="form.account_id" class="input" maxlength="50" />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Leave blank if you have one spread-betting account.</p></div>
          <div><label for="ig-start" class="label">History start date</label><input id="ig-start" v-model="form.sync_start_date" class="input" type="date" required /></div>
          <p class="rounded-lg border border-gray-200 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">The first sync downloads positions, transactions and activity privately for reconciliation. Reports and scheduled imports stay off during this step. Share dealing uses separate CSV statements because IG’s API excludes stockbroking.</p>
        </form>
        <footer class="flex justify-end gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
          <button type="button" class="btn-secondary" @click="emit('close')">Cancel</button>
          <button type="submit" form="ig-form" class="btn-primary" :disabled="loading || !valid">{{ loading ? 'Checking IG access…' : 'Connect IG' }}</button>
        </footer>
      </section>
    </div>
  </div>
</template>
<script setup>
import {computed,reactive} from 'vue'
const props=defineProps({loading:Boolean,error:String})
const emit=defineEmits(['close','save'])
const form=reactive({api_key:'',username:'',password:'',broker_environment:'live',account_id:'',sync_start_date:'2025-09-01'})
const valid=computed(()=>form.api_key.trim() && form.username.trim() && form.password && form.sync_start_date)
function submit() {if(!props.loading && valid.value)emit('save',{...form,api_key:form.api_key.trim(),username:form.username.trim(),account_id:form.account_id.trim()})}
</script>
