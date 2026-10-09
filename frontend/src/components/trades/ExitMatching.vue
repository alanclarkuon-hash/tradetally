<template>
  <div v-if="state.supported" class="card mb-6">
    <div class="card-body">
      <h3 class="text-lg font-medium text-gray-900 dark:text-white">Correct matched exits</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Detach an incorrectly matched sell here, then open the correct trade and link that sell. Its execution and fees are retained.</p>
      <label class="block mt-4 text-sm font-medium text-gray-700 dark:text-gray-300" for="exit-correction-reason">Reason for correction</label>
      <input id="exit-correction-reason" v-model="reason" maxlength="1000" class="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2" placeholder="Why does this sell belong to a different trade?" />
      <p v-if="error" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      <div v-if="state.exits.length" class="mt-4 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead><tr class="text-left text-gray-500 dark:text-gray-400"><th class="py-2 pr-4">Matched sell</th><th class="py-2 pr-4">Quantity</th><th class="py-2 pr-4">Price</th><th class="py-2"></th></tr></thead>
          <tbody><tr v-for="e in state.exits" :key="e.index" class="border-t border-gray-200 dark:border-gray-700"><td class="py-3 pr-4">{{ date(e.datetime) }}</td><td class="py-3 pr-4 font-mono">{{ e.quantity }}</td><td class="py-3 pr-4 font-mono">{{ money(e.price) }}</td><td class="py-3 text-right"><button class="btn-secondary" :disabled="busy" @click="submit({operation:'detach',index:e.index})">Detach sell</button></td></tr></tbody>
        </table>
      </div>
      <h4 class="mt-5 font-medium text-gray-900 dark:text-white">Unmatched sells for {{ trade.symbol }}</h4>
      <p v-if="!state.available.length" class="mt-2 text-sm text-gray-500 dark:text-gray-400">No detached sells in this account. Detach the sell from its current trade first.</p>
      <div v-for="r in state.available" :key="r.id" class="flex flex-wrap gap-3 items-center justify-between border-t border-gray-200 dark:border-gray-700 py-3">
        <span class="text-sm">{{ date(r.execution.datetime) }} · {{ r.execution.quantity }} shares · {{ money(r.execution.price) }}</span>
        <div class="flex items-center gap-3"><router-link class="text-sm text-primary-600 dark:text-primary-400" :to="'/trades/'+r.originTradeId">Source trade</router-link><button class="btn-primary" :disabled="busy" @click="submit({operation:'attach',exitId:r.id})">Link sell</button></div>
      </div>
      <details v-if="state.history.length" class="mt-4 text-sm"><summary class="cursor-pointer text-gray-600 dark:text-gray-400">Exit correction history</summary><div v-for="(h,i) in state.history" :key="i" class="mt-2 text-gray-600 dark:text-gray-400">{{ date(h.created_at) }} · {{ h.to_trade_id ? 'Sell linked' : 'Sell detached' }} · {{ h.reason }}</div></details>
    </div>
  </div>
</template>
<script setup>
import {ref,watch} from 'vue'
import api from '@/services/api'
import {useCurrencyFormatter} from '@/composables/useCurrencyFormatter'
const props=defineProps({trade:{type:Object,required:true}})
const emit=defineEmits(['changed'])
const state=ref({supported:false,exits:[],available:[],history:[]}),reason=ref(''),error=ref(''),busy=ref(false)
const date=v=>new Date(v).toLocaleString('en-GB')
const {formatCurrency}=useCurrencyFormatter()
const money=v=>formatCurrency(v,{currency:props.trade.original_currency||'GBP'})
async function load(){try{state.value=(await api.get(`/trades/${props.trade.id}/exit-matching`)).data}catch(e){error.value=e.response?.data?.error||'Unable to load exit corrections'}}
watch(()=>props.trade.id,()=>{state.value.supported=false;load()},{immediate:true})
async function submit(action){
 if(!reason.value.trim()){error.value='Enter a reason for the correction';return}
 busy.value=true;error.value=''
 try{await api.post(`/trades/${props.trade.id}/exit-matching`,{...action,version:state.value.version,reason:reason.value});reason.value='';await load();emit('changed')}
 catch(e){error.value=e.response?.data?.error||'Unable to correct the exit'}finally{busy.value=false}
}
</script>
