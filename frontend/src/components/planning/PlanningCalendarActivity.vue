
<template><section v-if="events.length||error" class="card p-5 mb-6"><div class="flex justify-between"><h2 class="font-semibold">Plan activity</h2><RouterLink to="/dashboard/planning" class="text-primary-400">All plans</RouterLink></div><p v-if="error" class="text-amber-300">{{ error }}</p><div class="flex flex-wrap gap-3 mt-3"><RouterLink v-for="(e,i) in events" :key="i" :to="'/dashboard/planning/'+e.plan_id" class="rounded border border-gray-700 px-3 py-2 text-sm"><small class="block text-gray-400">{{ new Date(e.created_at).toLocaleDateString() }}</small>{{ e.symbol }} · {{ e.event_type==='trade_linked'?(e.action==='entry'?'Entered':'Exited'):labels[e.event_type]||e.event_type }}<span class="text-gray-400 block">Now {{ e.status.replaceAll('_',' ') }}</span></RouterLink></div></section></template>
<script setup>
import {ref,watch} from 'vue'
import api from '@/services/api'
const props=defineProps({year:Number}),events=ref([]),error=ref('')
const labels={ready:'Finalised',finalised:'Finalised',watching:'Watching',trade_linked:'Entry / exit',reviewed:'Reviewed',completed:'Closed',stop_changed:'Stop changed',option_rolled:'Rolled'}
let sequence=0
watch(()=>props.year,async year=>{const n=++sequence;try{const r=await api.get('/trade-plans/calendar',{params:{year}});if(n===sequence){events.value=r.data.events||[];error.value=''}}catch{if(n===sequence)error.value='Plan activity could not load. Trading performance remains available.'}},{immediate:true})
</script>
