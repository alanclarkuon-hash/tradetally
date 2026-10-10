<template>
  <button type="button" class="btn-secondary currency-toggle" :disabled="disabled || options.length < 2" :aria-label="label" :title="label" @click.stop="cycle" @keydown.stop>{{ symbol }}</button>
</template>
<script setup>
import { computed } from 'vue'
import { CURRENCY_OPTIONS } from '@/composables/useCurrencyFormatter'
const props = defineProps({ modelValue: String, currencies: { type: Array, default: () => [] }, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const options = computed(() => [...new Set(props.currencies.filter(Boolean))])
const next = computed(() => options.value[(options.value.indexOf(props.modelValue) + 1) % options.value.length])
const symbol = computed(() => CURRENCY_OPTIONS.find(c => c.code === props.modelValue)?.symbol || props.modelValue)
const label = computed(() => `Showing ${props.modelValue}` + (options.value.length > 1 ? `; switch to ${next.value}` : ''))
function cycle() { if (!props.disabled && options.value.length > 1) emit('update:modelValue', next.value) }
</script>
<style scoped>
.currency-toggle{min-width:42px;min-height:40px;font-size:18px;line-height:1.25;color:#fb923c;padding:6px 12px;flex-shrink:0;align-self:flex-end}
.currency-toggle:disabled{opacity:.7;cursor:default}
</style>
