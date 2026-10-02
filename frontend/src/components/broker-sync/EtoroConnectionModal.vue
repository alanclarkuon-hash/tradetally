<template>
  <div class="fixed inset-0 z-50 overflow-y-auto" @keydown.esc="emit('close')">
    <div class="flex min-h-full items-center justify-center p-4">
      <div class="fixed inset-0 bg-black/50" @click="emit('close')"></div>
      <section role="dialog" aria-modal="true" aria-labelledby="etoro-title"
        class="relative w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-gray-800">
        <header class="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div><h3 id="etoro-title" class="text-lg font-semibold text-gray-900 dark:text-white">Connect eToro</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Stocks, ETFs and crypto · Real account</p></div>
          <button type="button" class="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close eToro connection" @click="emit('close')">✕</button>
        </header>
        <form id="etoro-form" class="space-y-4 p-6" @submit.prevent="submit">
          <div class="rounded-lg bg-green-50 p-4 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
            Use the <strong>Read All</strong> keys created for your real account. TradeTally only reads your data.
            <a href="https://builders.etoro.com/learn/authentication-and-api-keys" target="_blank" rel="noopener noreferrer"
              class="mt-2 block underline">eToro key setup instructions</a>
          </div>
          <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{{ error }}</p>
          <div><label for="etoro-label" class="label">Account label (optional)</label>
            <input id="etoro-label" v-model="form.account_label" class="input" maxlength="255" placeholder="My eToro account" /></div>
          <div><label for="etoro-public-key" class="label">Public API Key</label>
            <input id="etoro-public-key" v-model="form.api_key" class="input" type="password" autocomplete="off" maxlength="4096" required /></div>
          <div><label for="etoro-user-key" class="label">User Key</label>
            <input id="etoro-user-key" v-model="form.user_key" class="input" type="password" autocomplete="off" maxlength="4096" required />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Both keys are encrypted before storage. Enter them here, never in chat.</p></div>
          <div class="rounded-lg border border-gray-200 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
            <p class="font-medium text-gray-900 dark:text-white">First sync: download for review</p>
            <p class="mt-1">Current positions and recent closed trades are saved privately for checking before they appear in your reports. Auto-sync stays off during this check.</p>
            <p class="mt-2">The API documents less than one year of closed trades. Older history may need an account statement, including past copied trades.</p>
          </div>
        </form>
        <footer class="flex justify-end gap-3 border-t border-gray-200 p-6 dark:border-gray-700">
          <button class="btn-secondary" type="button" @click="emit('close')">Cancel</button>
          <button class="btn-primary" form="etoro-form" type="submit" :disabled="loading || !valid">{{ loading ? 'Checking keys…' : 'Connect eToro' }}</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue'
defineProps({ loading: Boolean, error: String })
const emit = defineEmits(['save', 'close'])
const form = reactive({ account_label: '', api_key: '', user_key: '' })
const valid = computed(() => form.api_key.trim() && form.user_key.trim())
function submit() {
  if (valid.value) emit('save', { account_label: form.account_label, api_key: form.api_key.trim(), user_key: form.user_key.trim() })
}
</script>
