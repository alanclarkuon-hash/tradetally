<template>
  <button type="button" class="w-10 h-10 inline-flex items-center justify-center rounded-md border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700" :class="{'text-primary-600 dark:text-primary-400':hideAmounts}" :aria-pressed="hideAmounts" :aria-label="hideAmounts?'Show monetary values':'Hide monetary values'" :title="hideAmounts?'Show monetary values':'Hide monetary values'" @click="toggle">
    <component :is="hideAmounts?EyeSlashIcon:EyeIcon" class="w-5 h-5" aria-hidden="true" />
  </button>
</template>
<script setup>
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { useDashboardPrivacy } from '@/composables/useDashboardPrivacy'
const { hideAmounts, toggle } = useDashboardPrivacy()
</script>
