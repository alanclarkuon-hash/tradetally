
<template><details class="card p-5"><summary class="font-semibold cursor-pointer">Entry / exit tactics and market context</summary><p v-if="error" role="alert" class="text-red-400 mt-3">{{ error }}</p><div class="grid md:grid-cols-3 gap-5 mt-4"><div v-for="kind in ['entry','exit','context']" :key="kind"><h3 class="font-semibold">{{ labels[kind] }}</h3><button v-for="t in tags.filter(t=>t.kind===kind)" :key="t.id" class="block text-left border-b border-gray-700 py-3 w-full" @click="form={kind:t.kind,name:t.name,definition:t.definition}"><strong class="text-primary-400">{{ t.name }}</strong><p class="text-sm text-gray-400">{{ t.definition }}</p></button></div></div><form class="grid sm:grid-cols-2 gap-3 mt-5" @submit.prevent="save"><label>Kind<select v-model="form.kind" class="input"><option value="entry">Entry tactic</option><option value="exit">Exit tactic</option><option value="context">Market context</option></select></label><label>Name<input v-model="form.name" maxlength="100" required class="input"></label><label class="sm:col-span-2">Definition<textarea v-model="form.definition" maxlength="2000" class="input"></textarea></label><button class="btn-primary" :disabled="busy">Save definition</button></form></details></template>
<script setup>
import {ref,onMounted} from 'vue'
import api from '@/services/api'
const tags=ref([]),form=ref({kind:'entry',name:'',definition:''}),error=ref(''),busy=ref(false),labels={entry:'Entry tactics',exit:'Exit tactics',context:'Market context'}
async function load(){tags.value=(await api.get('/trade-plans/library')).data.tags||[]}
async function save(){busy.value=true;try{await api.post('/trade-plans/library',form.value);await load();error.value=''}catch(e){error.value=e.response?.data?.error||'Tag definition could not save'}finally{busy.value=false}}
onMounted(async()=>{try{await load()}catch{error.value='Tactic library could not load'}})
</script>
