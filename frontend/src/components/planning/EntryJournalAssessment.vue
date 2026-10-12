<template>
 <section class="border border-gray-700 rounded-lg p-4 space-y-4" aria-label="Entry journal assessment">
  <div class="flex justify-between items-center gap-3"><h3 class="font-semibold">Entry journal assessment · {{ entry?.label }}</h3><button type="button" class="btn-secondary" @click="$emit('close')">Close</button></div>
  <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
  <div class="grid sm:grid-cols-2 gap-4">
   <label class="block">Journal session<input v-model="form.sessionDate" type="date" class="input" :max="today" @change="loadEntries" /></label>
   <label class="block">Saved journal<select v-model="form.journalId" class="input"><option :value="null">No journal — record an exception</option><option v-for="j in journals" :key="j.id" :value="j.id">{{ j.title||'Untitled journal' }} · {{ j.date }}</option></select></label>
  </div>
  <div v-if="selected" class="text-sm flex flex-wrap items-center gap-3 text-gray-500 dark:text-gray-400"><span>Saved {{ time(selected.updatedAt) }}</span><span v-if="selected.marketBias">{{ selected.marketBias }}</span><RouterLink :to="'/diary/'+selected.id+'/edit'" class="text-primary-500">Open journal</RouterLink><button class="btn-secondary" @click="loadEntries">Refresh saved journals</button></div>
  <label class="flex gap-3 items-start"><input v-model="form.journalReviewed" type="checkbox">I reviewed this session's journal and daily checklist for this entry.</label>
  <label class="flex gap-3 items-start"><input v-model="form.positionsReviewed" type="checkbox">I reviewed my existing positions before this entry.</label>
  <label class="block">Entry assessment notes<textarea v-model="form.notes" class="input" rows="2" placeholder="Relevant observations for this entry or add" /></label>
  <label v-if="exceptionNeeded" class="block">Reason for missing or earlier-session evidence<textarea v-model="form.exceptionReason" class="input" rows="2" placeholder="Explain the exception" /></label>
  <label v-if="hasEntries" class="flex gap-3 items-start"><input v-model="form.attachToExisting" type="checkbox">Attach to entries in this row that have no journal evidence. It will be marked retrospective.</label>
  <div class="flex gap-3 flex-wrap items-center"><button class="btn-primary" :disabled="saving||loading||!form.sessionDate||(exceptionNeeded&&form.exceptionReason.trim().length<10)" @click="save">Save entry assessment</button><span class="text-sm text-gray-500 dark:text-gray-400">A dated copy is retained with the plan.</span></div>
 </section>
</template>
<script setup>
import {ref,computed,onMounted,watch} from 'vue'
import api from '@/services/api'
const props=defineProps({plan:Object,entry:Object,hasEntries:Boolean}),emit=defineEmits(['saved','close'])
const form=ref({sessionDate:'',journalId:null,journalReviewed:false,positionsReviewed:false,notes:'',exceptionReason:'',attachToExisting:false}),today=ref(''),journals=ref([]),error=ref(''),loading=ref(false),saving=ref(false)
const selected=computed(()=>journals.value.find(j=>j.id===form.value.journalId))
const exceptionNeeded=computed(()=>!selected.value||!form.value.journalReviewed||!form.value.positionsReviewed||form.value.sessionDate!==today.value)
const time=v=>new Date(v).toLocaleString('en-GB')
watch(()=>form.value.journalId,()=>{form.value.journalReviewed=false;form.value.positionsReviewed=false})
async function loadEntries(){const previous=selected.value;loading.value=true;error.value='';try{const r=await api.get('/trade-plans/journal-candidates',{params:form.value.sessionDate?{date:form.value.sessionDate}:{}});today.value=r.data.today;if(!form.value.sessionDate)form.value.sessionDate=r.data.today;journals.value=r.data.entries||[];if(previous?.revision!==selected.value?.revision||previous?.date!==form.value.sessionDate){form.value.journalReviewed=false;form.value.positionsReviewed=false}if(!journals.value.some(j=>j.id===form.value.journalId))form.value.journalId=null}catch(e){error.value=e.response?.data?.error||'Saved journals could not be loaded'}finally{loading.value=false}}
async function save(){saving.value=true;error.value='';try{await api.post('/trade-plans/'+props.plan.id+'/journal-assessments',{...form.value,version:props.plan.version,stageKey:props.entry.key,journalRevision:selected.value?.revision||null});emit('saved')}catch(e){error.value=e.response?.data?.error||'Journal assessment was not saved'}finally{saving.value=false}}
onMounted(loadEntries)
</script>
