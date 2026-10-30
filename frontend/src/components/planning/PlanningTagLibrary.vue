<template>
  <details class="card p-5">
    <summary class="font-semibold cursor-pointer">Entry / exit tactics and market context</summary>
    <div class="flex flex-wrap items-center justify-between gap-3 mt-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">Manage tags for future selections. Existing plan and review tags are kept when a library tag is renamed or deleted.</p>
      <button class="btn-secondary" :disabled="busy || loading" @click="reset">Add tag</button>
    </div>
    <p v-if="error" role="alert" class="text-red-500 mt-3">{{ error }}</p>
    <p v-if="notice" role="status" class="text-green-500 mt-3">{{ notice }}</p>
    <p v-if="loading" role="status" class="mt-3">Loading tags…</p>
    <div class="grid md:grid-cols-3 gap-5 mt-4">
      <section v-for="kind in kinds" :key="kind" :aria-label="labels[kind]">
        <h3 class="font-semibold">{{ labels[kind] }}</h3>
        <p v-if="!loading && !tags.some(t=>t.kind===kind)" class="text-sm text-gray-500 py-3">No tags yet.</p>
        <div v-for="tag in tags.filter(t=>t.kind===kind)" :key="tag.id" class="border-b border-gray-200 dark:border-gray-700 py-3 space-y-2">
          <strong class="text-primary-500 break-words">{{ tag.name }}</strong>
          <p class="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words">{{ tag.definition }}</p>
          <div class="flex gap-3">
            <button class="text-sm text-primary-500 underline" :disabled="busy" :aria-label="`Edit ${tag.name}`" @click="edit(tag)">Edit</button>
            <button class="text-sm text-red-500 underline" :disabled="busy" :aria-label="`Delete ${tag.name}`" @click="removing=tag; error=''">Delete</button>
          </div>
        </div>
      </section>
    </div>
    <form class="grid sm:grid-cols-2 gap-3 mt-5 border-t border-gray-200 dark:border-gray-700 pt-5" @submit.prevent="save">
      <h3 class="font-semibold sm:col-span-2">{{ editing ? 'Edit tag' : 'Add tag' }}</h3>
      <label>Kind<select v-model="form.kind" class="input" :disabled="busy || loading"><option value="entry">Entry tactic</option><option value="exit">Exit tactic</option><option value="context">Market context</option></select></label>
      <label>Name<input v-model="form.name" maxlength="100" required class="input" :disabled="busy || loading"></label>
      <label class="sm:col-span-2">Definition<textarea v-model="form.definition" maxlength="2000" class="input" :disabled="busy || loading"></textarea></label>
      <div class="flex gap-3 sm:col-span-2"><button class="btn-primary" :disabled="busy || loading || !form.name.trim()">{{ busy ? 'Saving…' : editing ? 'Save changes' : 'Add tag' }}</button><button v-if="editing" type="button" class="btn-secondary" :disabled="busy" @click="reset">Cancel editing</button></div>
    </form>
    <BaseModal :model-value="!!removing" title="Delete tag" @update:model-value="value=>{if(!value&&!busy)removing=null}">
      <p>Delete “{{ removing?.name }}” from the tag library? Existing plan and review tags will be kept.</p>
      <p v-if="error" role="alert" class="text-red-500 mt-3">{{ error }}</p>
      <template #footer><button class="btn-secondary" :disabled="busy" @click="removing=null">Cancel</button><button class="btn-primary" :disabled="busy" @click="remove">{{ busy ? 'Deleting…' : 'Delete tag' }}</button></template>
    </BaseModal>
  </details>
</template>
<script setup>
import {ref,onMounted} from 'vue'
import api from '@/services/api'
import BaseModal from '@/components/common/BaseModal.vue'
const kinds=['entry','exit','context'],labels={entry:'Entry tactics',exit:'Exit tactics',context:'Market context'}
const blank=()=>({kind:'entry',name:'',definition:''})
const tags=ref([]),form=ref(blank()),editing=ref(null),removing=ref(null),error=ref(''),notice=ref(''),busy=ref(false),loading=ref(true)
function reset(){editing.value=null;form.value=blank();error.value='';notice.value=''}
function edit(tag){editing.value=tag.id;form.value={kind:tag.kind,name:tag.name,definition:tag.definition};error.value='';notice.value=''}
function sorted(rows){return [...rows].sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name))}
async function save(){
 if(busy.value)return
 busy.value=true;error.value='';notice.value=''
 try{
  const response=editing.value?await api.put('/trade-plans/library/'+editing.value,form.value):await api.post('/trade-plans/library',form.value)
  tags.value=sorted(tags.value.filter(t=>t.id!==response.data.tag.id).concat(response.data.tag))
  const message=editing.value?'Tag updated.':'Tag added.';reset();notice.value=message
 }catch(e){error.value=e.response?.data?.error||'Tag could not be saved'}finally{busy.value=false}
}
async function remove(){
 if(busy.value||!removing.value)return
 busy.value=true;error.value='';notice.value=''
 try{
  const id=removing.value.id;await api.delete('/trade-plans/library/'+id)
  tags.value=tags.value.filter(t=>t.id!==id);if(editing.value===id)reset()
  removing.value=null;notice.value='Tag deleted. Existing plan and review tags were kept.'
 }catch(e){error.value=e.response?.data?.error||'Tag could not be deleted'}finally{busy.value=false}
}
onMounted(async()=>{try{tags.value=(await api.get('/trade-plans/library')).data.tags||[]}catch{error.value='Tactic library could not load'}finally{loading.value=false}})
</script>
