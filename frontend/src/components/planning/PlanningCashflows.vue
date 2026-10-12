<template>
 <section class="card p-5 space-y-4" aria-label="Plan dividends and financing">
  <div class="flex justify-between items-center gap-3"><h2>Dividends and financing</h2><CurrencyToggle :model-value="currency" :currencies="currencies" @update:model-value="$emit('update:currency',$event)" /></div>
  <div class="grid sm:grid-cols-3 gap-4 text-sm"><div v-for="(label,kind) in {dividend:'Additional dividends',financing:'Additional financing',withholding:'Additional withholding tax'}" :key="kind"><span class="text-gray-500 dark:text-gray-400">{{ label }}</span><strong class="block mt-1">{{ total(kind) }}</strong></div></div>
  <p v-if="cashflows.unresolved" role="alert" class="text-amber-700 dark:text-amber-300">{{ cashflows.unresolved }} cashflow sources changed or need historical FX. Confirm them before relying on the total.</p>
  <p v-if="cashflows.pending" class="text-amber-700 dark:text-amber-300 text-sm">{{ cashflows.pending }} possible plan cashflows need attribution. They are not included yet.</p>
  <div v-if="cashflows.entries?.length" class="overflow-x-auto"><table class="w-full text-sm"><thead><tr><th>Date</th><th>Cashflow</th><th>Allocated amount</th><th>Treatment</th></tr></thead><tbody><tr v-for="e in cashflows.entries" :key="e.linkId||e.id"><td class="p-2 whitespace-nowrap">{{ e.date }}</td><td class="p-2">{{ e.description }}</td><td class="p-2 whitespace-nowrap">{{ amount(e,e.fraction) }}</td><td class="p-2">{{ status(e) }}{{ e.automatic?' · Broker position match':'' }}<span v-if="e.status==='include'&&e.embeddedFraction>0"> · {{ Math.min(e.fraction,e.embeddedFraction)*100 }}% already included; remaining allocation added</span><button v-if="editable&&e.linkId" class="btn-secondary ml-2" @click="choose(e)">Change attribution</button><p v-if="e.reason" class="text-gray-500 dark:text-gray-400">{{ e.reason }}</p></td></tr></tbody></table></div>
  <p v-else class="text-sm text-gray-500 dark:text-gray-400">No attributable cashflows included yet.</p>
  <button v-if="editable" type="button" class="btn-secondary" :aria-expanded="expanded" @click="expanded=!expanded">{{ expanded?'Hide cashflows':'Find cashflows' }}</button>
  <div v-if="expanded" class="space-y-4 border-t border-gray-700 pt-4">
   <label class="block text-sm">Search saved account cashflows<input v-model="search" class="input" placeholder="Description, date or currency" /></label>
   <p class="text-sm text-gray-500 dark:text-gray-400">Confirm which payments belong to this plan. Amounts already included in broker profit add nothing again.</p>
   <div class="max-h-72 overflow-y-auto space-y-2"><button v-for="e in filtered.slice(0,60)" :key="e.id" class="block w-full text-left p-3 border border-gray-700 rounded-lg" :aria-pressed="chosen?.id===e.id" @click="choose(e)">{{ e.date }} · {{ e.description }} · {{ amount(e,1) }}{{ e.likely?' · Possible match':'' }}</button><p v-if="!filtered.length">No matching saved cashflows.</p><p v-if="filtered.length>60" class="text-sm">Refine the search to see more cashflows.</p></div>
   <div v-if="chosen" class="space-y-3">
    <p>{{ chosen.date }} · {{ chosen.description }} · {{ amount(chosen,1) }}</p>
    <div v-if="chosen.id" class="grid sm:grid-cols-2 gap-3"><label class="block">Allocated %<input v-model.number="form.percent" aria-label="Cashflow allocated percent" type="number" min="0.000001" :max="chosen.availableFraction*100" step="any" class="input" /></label><label class="block">Treatment<select v-model="form.treatment" aria-label="Cashflow treatment" class="input"><option v-if="!chosen.includedProof" value="include">Include in plan P&amp;L</option><option value="already_included">Already included in broker P&amp;L</option><option value="exclude">Not part of this plan</option></select></label></div>
    <label class="block">Attribution reason<textarea v-model="form.reason" class="input" rows="2" placeholder="Why this amount belongs to this plan, or why it is excluded" /></label>
    <p v-if="error" role="alert" class="text-red-500">{{ error }}</p><button class="btn-primary" :disabled="saving||(chosen.id&&(!(form.percent>0)||form.percent>chosen.availableFraction*100))||form.reason.trim().length<10" @click="save">{{ chosen.id?'Save cashflow attribution':'Remove missing-source attribution' }}</button>
   </div>
  </div>
 </section>
</template>
<script setup>
import {ref,computed,nextTick} from 'vue'
import api from '@/services/api'
import CurrencyToggle from '@/components/common/CurrencyToggle.vue'
const props=defineProps({plan:Object,cashflows:{type:Object,default:()=>({})},currency:String,currencies:Array,rates:Object,editable:Boolean,prepareSave:Function}),emit=defineEmits(['saved','update:currency'])
const expanded=ref(false),search=ref(''),chosen=ref(null),error=ref(''),saving=ref(false),form=ref({percent:100,treatment:'include',reason:''})
const filtered=computed(()=>(props.cashflows.candidates||[]).filter(e=>(e.date+' '+e.description+' '+e.currency).toLowerCase().includes(search.value.toLowerCase())))
function converted(e){if(e.currency===props.currency)return e.amount;if(e.accountCurrency===props.currency)return e.accountAmount;if(props.cashflows.currency===props.currency)return e.instrumentAmount;const rates={USD:1,...props.rates};return e.accountAmount!=null&&rates[e.accountCurrency]>0&&rates[props.currency]>0?e.accountAmount*rates[props.currency]/rates[e.accountCurrency]:null}
function format(v){return v==null?'FX unavailable':new Intl.NumberFormat('en-GB',{style:'currency',currency:props.currency||'USD'}).format(v)}
function amount(e,f){const v=converted(e);return format(v==null?null:v*f)}
function total(kind){const rows=(props.cashflows.entries||[]).filter(e=>e.category===kind&&e.status==='include');return rows.some(e=>converted(e)==null)?'FX unavailable':format(rows.reduce((v,e)=>v+converted(e)*(e.effectiveFraction??e.fraction),0))}
function status(e){return {include:'Included',already_included:'Already included in broker profit',exclude:'Excluded',source_changed:'Source changed · confirm again',fx_missing:'Historical FX missing',pending:'Needs confirmation'}[e.status]||e.status}
function choose(e){chosen.value=e;error.value='';form.value={percent:Math.min(e.fraction,e.availableFraction??1)*100,treatment:e.includedProof?'already_included':e.treatment==='pending'?'include':e.treatment,reason:e.reason||''}}
async function save(){saving.value=true;error.value='';try{if(props.prepareSave&&!await props.prepareSave())return;await nextTick();if(!chosen.value.id){await api.delete('/trade-plans/'+props.plan.id+'/cashflows/'+chosen.value.linkId,{data:{version:props.plan.version,reason:form.value.reason}})}else await api.post('/trade-plans/'+props.plan.id+'/cashflows',{version:props.plan.version,cashEventId:chosen.value.id,fingerprint:chosen.value.fingerprint,fraction:form.value.percent/100,treatment:form.value.treatment,reason:form.value.reason});chosen.value=null;emit('saved')}catch(e){error.value=e.response?.data?.error||'Cashflow attribution was not saved'}finally{saving.value=false}}
</script>
