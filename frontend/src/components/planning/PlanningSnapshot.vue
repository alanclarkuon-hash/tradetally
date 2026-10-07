<template>
  <section v-if="url" class="card p-5">
    <h2 class="font-semibold text-lg">Chart evidence</h2>
    <template v-if="snapshot">
      <button type="button" class="btn-secondary mt-3" @click="open=true">View snapshot</button>
      <p class="text-sm text-gray-400 mt-2">Open the linked snapshot inside TradeTally. A private retained copy is not saved yet.</p>
    </template>
    <p v-else class="text-sm text-gray-400 mt-3">Paste a TradingView snapshot link (tradingview.com/x/…) to view its image here. Live chart layouts and other links open on their original site.</p>
    <a v-if="safeSource" :href="safeSource" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="inline-block mt-3 text-primary-400 text-sm">Open original chart</a>
    <BaseModal v-if="snapshot" v-model="open" :title="'Chart snapshot · '+asset" size="5xl">
      <div class="rounded-md bg-gray-950 p-2 overflow-auto">
        <p v-if="state==='loading'" role="status" class="p-6 text-gray-300">Loading snapshot…</p>
        <p v-if="state==='error'" role="alert" class="p-6 text-amber-400">The snapshot could not be loaded. It may no longer be available. Check the link or open the original chart.</p>
        <img v-if="open&&state!=='error'" :key="snapshot.imageUrl" :src="snapshot.imageUrl" :alt="'Chart snapshot for '+asset" referrerpolicy="no-referrer" class="w-full h-auto" :class="{'invisible':state==='loading'}" @load="state='loaded'" @error="state='error'">
      </div>
      <template #footer>
        <a :href="snapshot.sourceUrl" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="btn-secondary">Open in TradingView</a>
        <button v-if="state==='error'" type="button" class="btn-secondary" @click="retry">Retry snapshot</button>
        <button type="button" class="btn-primary" @click="open=false">Close snapshot</button>
      </template>
    </BaseModal>
  </section>
</template>
<script setup>
import {computed,ref,watch,nextTick} from 'vue'
import BaseModal from '@/components/common/BaseModal.vue'
import {tradingViewSnapshot} from '@/utils/tradingViewSnapshot'
const props=defineProps({url:{type:String,default:''},asset:{type:String,default:'Planned asset'}})
const open=ref(false),state=ref('loading')
const snapshot=computed(()=>tradingViewSnapshot(props.url))
const safeSource=computed(()=>{try{const u=new URL(props.url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}})
watch(open,()=>{state.value='loading'})
watch(()=>props.url,()=>{open.value=false;state.value='loading'})
async function retry(){state.value='error';await nextTick();state.value='loading'}
</script>