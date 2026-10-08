
<template><div class="min-w-40"><div class="flex flex-wrap gap-1 mb-2"><button v-for="name in modelValue||[]" :key="name" type="button" class="text-xs rounded-full bg-primary-500/20 text-primary-300 px-2 py-1" :disabled="disabled" @click="remove(name)" :title="definition(name)">{{ name }} <span aria-hidden="true">×</span></button></div><select class="input" :disabled="disabled" aria-label="Add existing tag" @change="add($event)"><option value="">Select tag</option><option v-for="t in tags||[]" :key="t.id" :value="t.name">{{ t.name }}</option></select></div></template>
<script setup>
const props=defineProps({modelValue:Array,tags:Array,disabled:Boolean}),emit=defineEmits(['update:modelValue'])
function definition(name){return props.tags?.find(t=>t.name===name)?.definition||name}
function add(e){const name=e.target.value;if(name)emit('update:modelValue',[...new Set([...(props.modelValue||[]),name])]);e.target.value=''}
function remove(name){emit('update:modelValue',(props.modelValue||[]).filter(n=>n!==name))}
</script>
