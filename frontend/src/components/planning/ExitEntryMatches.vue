<template>
 <div v-if="matching.length" class="space-y-3 mb-5" aria-label="Exit entry matches">
  <div v-for="row in matching" :key="row.exitKey" class="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
   <div class="flex flex-wrap items-center justify-between gap-3">
    <div><strong>{{ label(exits,row.exitKey) }}</strong><p v-if="row.status==='matched'" class="text-sm text-gray-500 dark:text-gray-400">Closes <span v-for="(match,i) in row.matches" :key="match.entryKey">{{ i?' + ':'' }}{{ units(match.quantity) }} from {{ label(entries,match.entryKey) }}</span></p><p v-else class="text-sm text-amber-700 dark:text-amber-300" role="status">Match entry rows to calculate this exit's realised profit.</p></div>
    <button v-if="editable" class="btn-secondary" type="button" :aria-expanded="active===row.exitKey" @click="edit(row)">{{ active===row.exitKey?'Cancel matching':'Match entries' }}</button>
   </div>
   <div v-if="active===row.exitKey" class="mt-4 space-y-3">
    <p class="text-sm">Choose which entry rows this exit closes. Match {{ units(row.quantity) }} units in total. Other entries remain open.</p>
    <p class="text-sm text-gray-500 dark:text-gray-400">Entries fully matched to other exits are hidden.</p>
    <label v-for="option in availableOptions(row)" :key="option.entryKey" class="flex flex-wrap items-center gap-3"><span class="min-w-32">{{ label(entries,option.entryKey) }}</span><input v-model.number="quantities[option.entryKey]" :aria-label="'Units from '+label(entries,option.entryKey)" type="number" min="0" :max="option.quantity+tolerance(option.quantity)" step="any" class="input max-w-48" /><small class="text-gray-500 dark:text-gray-400">{{ units(option.quantity) }} available units<span v-if="option.totalQuantity!=null"> · {{ units(option.totalQuantity) }} linked · {{ units(option.assignedQuantity) }} assigned to other exits</span></small></label>
    <p v-if="row.options.length&&!availableOptions(row).length" class="text-amber-700 dark:text-amber-300">These entry units are already matched to other exits. Change those matches first to free units.</p>
    <p v-if="!row.options.length" class="text-amber-700 dark:text-amber-300">Link earlier entries in this account before matching.</p>
    <p class="text-sm">Matched {{ units(total) }} / {{ units(row.quantity) }} units</p>
    <p v-if="error" class="text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    <button class="btn-primary" type="button" :disabled="saving||!valid(row)" @click="save(row)">{{ saving?'Saving matchesâ€¦':'Save entry matches' }}</button>
   </div>
  </div>
 </div>
</template>
<script setup>
import {ref,computed,nextTick,watch} from 'vue'
import api from '@/services/api'
import {equal,exceeds,tolerance} from '@/utils/planningQuantity'
const props=defineProps({plan:Object,matching:{type:Array,default:()=>[]},entries:{type:Array,default:()=>[]},exits:{type:Array,default:()=>[]},editable:Boolean,prepareSave:Function}),emit=defineEmits(['saved'])
const active=ref(null),quantities=ref({}),error=ref(''),saving=ref(false)
// Display broker precision without rounding the quantities used for validation.
const unitFormatter=new Intl.NumberFormat('en-GB',{useGrouping:false,maximumFractionDigits:8})
const units=value=>{
 const quantity=Number(value),display=unitFormatter.format(quantity)
 return quantity>0&&display==='0'?'Less than 0.00000001':display
}
const label=(rows,key)=>rows.find(row=>row.key===key)?.label||key
const availableOptions=row=>(row?.options||[]).filter(option=>option.quantity>0)
const total=computed(()=>availableOptions(props.matching.find(row=>row.exitKey===active.value)).reduce((q,option)=>q+Number(quantities.value[option.entryKey]||0),0))
const valid=row=>equal(total.value,row.quantity)&&availableOptions(row).some(o=>quantities.value[o.entryKey]>0)&&availableOptions(row).every(o=>Number.isFinite(quantities.value[o.entryKey])&&quantities.value[o.entryKey]>=0&&(quantities.value[o.entryKey]===0||o.quantity>0&&!exceeds(quantities.value[o.entryKey],o.quantity)))
function edit(row){error.value='';if(active.value===row.exitKey){active.value=null;return}active.value=row.exitKey;quantities.value=Object.fromEntries(availableOptions(row).map(o=>[o.entryKey,row.matches.find(m=>m.entryKey===o.entryKey)?.quantity||0]))}
watch(()=>props.plan.id,()=>{active.value=null;error.value=''})
async function save(row){saving.value=true;error.value='';try{if(props.prepareSave&&!await props.prepareSave())return;await nextTick();await api.put('/trade-plans/'+props.plan.id+'/exit-matches',{version:props.plan.version,exitKey:row.exitKey,matches:availableOptions(row).filter(o=>quantities.value[o.entryKey]>0).map(o=>({entryKey:o.entryKey,quantity:quantities.value[o.entryKey]}))});active.value=null;emit('saved')}catch(e){error.value=e.response?.data?.error||'Entry matches were not saved'}finally{saving.value=false}}
</script>
