<template>
  <sup v-if="label" class="quote-session-marker" :title="label" :aria-label="label">
    <svg v-if="session==='pre'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M3 18h18M5 22h14M7 18a5 5 0 0 1 10 0M12 2v4M4.2 7.2l2.8 2.8M19.8 7.2 17 10M1 13h4M19 13h4" />
    </svg>
    <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.8 15.4A9 9 0 0 1 8.6 3.2 9.2 9.2 0 1 0 20.8 15.4Z" /></svg>
  </sup>
</template>
<script setup>
import { computed } from 'vue'
const props=defineProps({session:String})
const label=computed(()=>({pre:'Pre-market quote',post:'Post-market quote',overnight:'Overnight quote'})[props.session]||null)
</script>
<style scoped>
.quote-session-marker{display:inline-flex;vertical-align:super;margin-left:2px;color:#facc15;line-height:0}
svg{width:.65em;height:.65em;min-width:8px;min-height:8px}
</style>
