<template>
 <div class="mb-4 space-y-4" aria-label="Remaining exit sizing">
  <p v-if="sizing.pending" class="text-amber-700 dark:text-amber-300">Position quantity changed. Recheck remaining exits; completed exits stay fixed.</p>
  <button class="btn-secondary" :aria-expanded="expanded" @click="expanded=!expanded">{{ expanded?'Hide exit recheck':'Recheck exit quantities' }}</button>
  <div v-if="expanded" class="space-y-4 border border-gray-700 rounded-lg p-4">
   <p v-if="sizing.needsReconciliation" role="alert">Reconcile changed fills or over-exits before confirming.</p>
   <div v-for="a in sizing.accounts.filter(a=>a.entered>0)" :key="a.accountId" class="space-y-3">
    <h3 class="font-semibold">{{ accounts.find(e=>e.id===a.accountId)?.accountName||'Plan account' }}</h3><p class="text-sm">Previous basis {{ number(a.basis) }} · Filled {{ number(a.entered) }} · Open {{ number(a.open) }}</p>
    <button class="btn-secondary" @click="suggest(a)">Use suggested quantities</button>
    <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr><th>Exit</th><th>Current quantity</th><th>Revised quantity</th><th></th></tr></thead><tbody><tr v-for="r in a.rows" :key="r.key"><td class="p-2">{{ r.label }}{{ r.completed?' · Completed':'' }}</td><td class="p-2">{{ number(r.quantity) }}</td><td class="p-2"><span v-if="r.completed">{{ number(r.quantity) }}</span><input v-else v-model.number="forms[a.accountId].units[r.key]" :aria-label="'Revised exit quantity '+r.label" type="number" min="0" step="any" class="input exit-quantity" /></td><td class="p-2"><button v-if="!r.completed" class="btn-secondary" @click="remainder(a,r)">Close remainder</button></td></tr></tbody></table></div>
    <p :class="remaining(a)<-1e-8?'text-red-500':'text-gray-500 dark:text-gray-400'">{{ remaining(a)<-1e-8?'Above open quantity by':'Unassigned remaining units' }} {{ number(Math.abs(remaining(a))) }}</p>
    <label class="block">Recheck reason<input v-model="forms[a.accountId].reason" class="input" /></label><p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
    <button class="btn-primary" :disabled="saving||sizing.needsReconciliation||remaining(a)<-1e-8||Object.values(forms[a.accountId].units).some(v=>typeof v!=='number'||v<0)||forms[a.accountId].reason.trim().length<10" @click="save(a)">Confirm remaining exits</button>
   </div>
  </div>
 </div>
</template>
<script setup>
import {ref,watch,nextTick} from 'vue'
import api from '@/services/api'
const props=defineProps({plan:Object,sizing:{type:Object,default:()=>({accounts:[]})},accounts:{type:Array,default:()=>[]},prepareSave:Function}),emit=defineEmits(['saved'])
const expanded=ref(false),forms=ref({}),error=ref(''),saving=ref(false)
const number=v=>Number(v||0).toLocaleString('en-GB',{maximumFractionDigits:6})
watch(()=>JSON.stringify(props.sizing),()=>{forms.value=Object.fromEntries((props.sizing.accounts||[]).map(a=>[a.accountId,{units:Object.fromEntries(a.rows.filter(r=>!r.completed).map(r=>[r.key,r.quantity??0])),reason:'Rechecked exits after position quantity changed'}]));if(props.sizing.pending)expanded.value=true},{immediate:true})
const remaining=a=>a.open-Object.values(forms.value[a.accountId].units).reduce((v,q)=>v+Number(q||0),0)
function suggest(a){for(const r of a.rows.filter(r=>!r.completed))forms.value[a.accountId].units[r.key]=r.suggested}
function remainder(a,r){const units=forms.value[a.accountId].units;units[r.key]=Math.max(0,a.open-Object.entries(units).filter(([key])=>key!==r.key).reduce((v,[,q])=>v+Number(q||0),0))}
async function save(a){saving.value=true;error.value='';try{const entered=a.entered;if(props.prepareSave&&!await props.prepareSave())return;await nextTick();const current=props.sizing.accounts.find(v=>v.accountId===a.accountId);if(current?.entered!==entered){error.value='Position changed after saving management. Check the exit quantities again.';return}await api.post('/trade-plans/'+props.plan.id+'/exit-sizing',{version:props.plan.version,accountId:a.accountId,entered,rows:Object.entries(forms.value[a.accountId].units).map(([key,units])=>({key,units})),reason:forms.value[a.accountId].reason});emit('saved')}catch(e){error.value=e.response?.data?.error||'Exit quantities were not saved'}finally{saving.value=false}}
</script>
<style scoped>.exit-quantity{width:120px;height:42px}</style>
