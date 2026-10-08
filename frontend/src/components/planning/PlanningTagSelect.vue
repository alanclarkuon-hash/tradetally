
<template><div class="tactic-editor"><div class="flex flex-wrap gap-1 mb-2"><button v-for="name in modelValue||[]" :key="name" type="button" class="tactic-chip" :disabled="disabled" @click="remove(name)" :title="definition(name)">{{ name }} <span aria-hidden="true">×</span></button></div><select class="input" :disabled="disabled" :aria-label="label" @change="add($event)"><option value="">Select tag</option><option v-for="t in tags||[]" :key="t.id" :value="t.name">{{ t.name }}</option></select></div></template>
<script setup>
const props=defineProps({modelValue:Array,tags:Array,disabled:Boolean,multiple:{type:Boolean,default:true},label:{type:String,default:"Add existing tag"}}),emit=defineEmits(['update:modelValue'])
function definition(name){return props.tags?.find(t=>t.name===name)?.definition||name}
function add(e){const name=e.target.value;if(name)emit('update:modelValue',props.multiple?[...new Set([...(props.modelValue||[]),name])]:[name]);e.target.value=''}
function remove(name){emit('update:modelValue',(props.modelValue||[]).filter(n=>n!==name))}
</script>

<style scoped>
.tactic-editor{min-width:180px;max-width:240px}
.tactic-chip{background:#334155;border:1px solid #475569;border-radius:6px;padding:3px 7px;color:#f3f4f6;font-size:12px;min-height:28px}
select.input{height:42px;border:1px solid #4b5563;background:#111827;border-radius:6px;padding:8px 10px;font-size:13px}
.tactic-chip:focus-visible,select:focus-visible{outline:2px solid #fb923c;outline-offset:3px}
:global(html:not(.dark) .tactic-chip){background:#f1f5f9;border-color:#cbd5e1;color:#334155}
:global(html:not(.dark) .tactic-editor select.input){background:#fff;border-color:#d1d5db;color:#111827}
</style>
