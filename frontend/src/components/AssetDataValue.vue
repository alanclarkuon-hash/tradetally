<template>
  <span v-if="value == null" class="text-gray-400">Not stored</span>
  <details v-else-if="typeof value === 'object'" class="nested-data">
    <summary>{{ Array.isArray(value) ? `${value.length} items` : `${Object.keys(value).length} fields` }}</summary>
    <dl class="asset-fields mt-3">
      <div v-for="(child,key) in value" :key="key"><dt>{{ label(key) }}</dt><dd><AssetDataValue :value="child" /></dd></div>
    </dl>
  </details>
  <a v-else-if="typeof value === 'string' && /^https?:\/\//i.test(value)" :href="value" target="_blank" rel="noopener noreferrer" class="text-primary-500 underline break-all">{{ value }}</a>
  <span v-else class="whitespace-pre-wrap break-words">{{ typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value }}</span>
</template>
<script setup>
defineProps({value:{default:null}})
const label=key=>String(key).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())
</script>
