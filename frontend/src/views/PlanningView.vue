<template>
  <div class="content-wrapper py-8 space-y-6">
    <nav class="flex gap-7 border-b border-gray-700" aria-label="Dashboard tabs"><RouterLink to="/dashboard" class="pb-3 text-gray-400">Trading</RouterLink><RouterLink to="/dashboard/portfolio" class="pb-3 text-gray-400">Portfolio</RouterLink><RouterLink to="/dashboard/planning" class="pb-3 border-b-2 border-primary-500 text-primary-400" @click="selected=null">Planning</RouterLink></nav>
    <div class="flex flex-wrap justify-between gap-4"><div><h1 class="heading-page">{{ selected ? assetLabel : 'Planning' }}</h1><p class="text-gray-400 mt-1">{{ selected ? [form?.instrument==='option'?'Single-leg option':form?.instrument==='spread_bet'?'Spread betting':form?.instrument==='crypto'?'Crypto':'Stock / shares',form?.direction==='short'?'Short / bearish':'Long / bullish',accountName(form?.accountId),playbookName(form?.playbookId)].join(' · ') : 'Prepared plans wait for their trigger. Ready reserves no capacity.' }}</p></div><div class="flex gap-2 items-center"><MoneyPrivacyToggle/><button class="btn-primary" @click="newPlan">New plan</button><button v-if="selected" class="btn-secondary" @click="closeDetail">All plans</button></div></div>
    <details class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><summary class="cursor-pointer text-amber-300">Test build · capacity is not verified automatically</summary><p class="mt-2">Plans, source-fill links, stop history and reviews are saved. Risk coverage remains incomplete where stops, costs, currency or broker constraints cannot be verified.</p></details>
    <p v-if="error" class="rounded-md bg-red-500/10 p-4 text-red-400" role="alert">{{ error }}</p>
    <div v-if="!selected" class="card p-5"><div class="flex justify-between flex-wrap gap-4"><h2 class="font-semibold">Outstanding entry commitments · all accounts</h2><span class="text-sm text-gray-400">Display filters do not change this scope</span></div><p v-if="!commitments.length" class="text-gray-400 mt-3">No committed entries.</p><div v-for="[currency,total] in commitmentTotals" :key="currency" class="mt-2">{{ money(total,currency) }} reserved in {{ currency }}</div><p class="text-sm text-amber-400 mt-3">Open-position risk and available capacity: not yet integrated. These totals are reservations only.</p></div>
    <template v-if="!selected">
      <div class="flex flex-wrap gap-3"><label>Stage<select v-model="stageFilter" class="input"><option value="active">All active</option><option value="all">All plans</option><option value="ready">Ready</option><option value="watching">Watching</option><option value="draft">Draft</option><option value="entered">Entered</option><option value="reviewed">Reviewed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label><label>Drafts<select v-model="draftFilter" class="input"><option value="all">Account filter from navigation</option><option value="unassigned">Unassigned plans</option></select></label><div class="text-sm text-gray-400 self-end pb-2">All active dates · {{ selectedAccountLabel }}</div></div>
      <div class="card p-5 overflow-x-auto"><table class="w-full text-sm"><thead><tr><th>Asset / playbook</th><th>Stage</th><th>Account</th><th>Planned risk budget</th><th>Next action</th></tr></thead><tbody><tr v-for="p in visiblePlans" :key="p.id"><td><button class="text-primary-400 font-semibold text-left" @click="openPlan(p)">{{ label(p.definition) }}</button><div>{{ p.definition.title }}</div><div class="text-gray-400">{{ playbookName(p.definition.playbookId) }}</div></td><td>{{ statusLabel(p.status) }}</td><td>{{ accountName(p.definition.accountId) }}</td><td>{{ money(p.definition.riskBudget,p.definition.currency) }}</td><td><button class="btn-secondary" @click="openPlan(p)">Open plan</button></td></tr></tbody></table><p v-if="!visiblePlans.length" class="text-gray-400 mt-4">No plans match the selection.</p><p v-if="loading" class="mt-4">Loading plans…</p></div>
    </template>
    <template v-else-if="!hideAmounts">
      <div class="flex flex-wrap items-center gap-3 border-b border-gray-700 pb-4"><span class="rounded bg-primary-500/10 text-primary-400 px-3 py-1">{{ statusLabel(selected.status) }}</span><span class="text-sm text-gray-400">{{ saveState }}</span><button class="btn-secondary" :disabled="saving||locked||selected.status==='cancelled'" @click="save">Save plan</button><button v-if="selected.id&&selected.status!=='ready'&&selected.status!=='cancelled'" class="btn-primary" :disabled="saving" @click="setStatus('ready')">Finalise plan · Ready</button><button v-if="selected.id&&selected.status==='ready'&&!locked" class="btn-secondary" @click="setStatus('watching')">Return to Watching</button><button v-if="selected.id&&['watching','ready'].includes(selected.status)&&!locked" class="btn-secondary" :disabled="saving" @click="setStatus('draft')">Return to Draft</button><button v-if="selected.id&&selected.status!=='cancelled'&&!locked" class="btn-secondary" @click="cancelPending=true">Cancel plan</button><button v-if="selected.id&&selected.status==='cancelled'&&!locked" class="btn-secondary" :disabled="saving" @click="setStatus('draft')">Reopen as Draft</button></div>
      <section v-if="cancelPending" class="rounded-md border border-amber-500/40 bg-amber-500/10 p-4" aria-label="Confirm plan cancellation"><p>Cancel this plan? It will leave All active, but its details and history will stay saved. You can find it under Cancelled and reopen it as a Draft.</p><div class="flex gap-3 mt-3"><button class="btn-secondary" :disabled="saving" @click="cancelPending=false">Keep plan</button><button class="btn-secondary text-red-400" :disabled="saving" @click="setStatus('cancelled')">Confirm cancellation</button></div></section>
      <p v-if="selected.status==='cancelled'" class="text-gray-400">This plan is retained with its history. Reopen as Draft to review and edit it; this does not mark it Ready or reserve capacity.</p>
      <p v-if="locked" class="text-amber-400">An entry is committed. Resolve its external order before editing this plan.</p>
      <PlanningWorkspace :plan="selected" :accounts="accounts" :playbooks="playbooks" :commitments="commitments" @updated="workspaceUpdated"/>
      <details v-if="history.length" class="card p-5"><summary class="cursor-pointer">Plan history</summary><div v-for="(e,i) in history" :key="i" class="py-2 border-b border-gray-700">{{ e.event_type.replaceAll('_',' ') }} · {{ new Date(e.created_at).toLocaleString() }}</div></details>
    </template>
    <p v-else class="card p-5">Plan details are concealed while monetary privacy is enabled. Use the eye control to reveal and edit them.</p>
  </div>
</template>
<script setup>
import {ref,computed,onMounted,watch,onBeforeUnmount,nextTick} from 'vue'
import {useRouter,useRoute} from 'vue-router'
import api from '@/services/api'
import {useAccountsStore} from '@/stores/accounts'
import {useGlobalAccountFilter} from '@/composables/useGlobalAccountFilter'
import {accountSelection} from '@/utils/accountSelection'
import {useDashboardPrivacy,MONEY_MASK} from '@/composables/useDashboardPrivacy'
import MoneyPrivacyToggle from '@/components/dashboard/MoneyPrivacyToggle.vue'
import PlanningWorkspace from '@/components/planning/PlanningWorkspace.vue'
const {hideAmounts}=useDashboardPrivacy(),router=useRouter(),route=useRoute(),accountStore=useAccountsStore()
const {selectedAccount,selectedAccountLabel}=useGlobalAccountFilter()
const entryFeedback=ref(null),committing=ref(false),commitError=ref(''),commitMessage=ref(''),cancelPending=ref(false),releaseReason=ref(''),releaseConfirmed=ref(false),pendingTemplate=ref(null),plans=ref([]),commitments=ref([]),playbooks=ref([]),selected=ref(null),form=ref(null),calculation=ref(null),history=ref([]),error=ref(''),loading=ref(false),saving=ref(false),saveState=ref(''),dirty=ref(false),stageFilter=ref('active'),draftFilter=ref('all'),percentStop=ref(true),chosenStage=ref('stage1'),riskReason=ref(''),checks=ref({trigger:false,context:false,protection:false,data:false})
const checkLabels={trigger:'Trigger and chart conditions confirmed',context:"Today's journal context and position review completed",protection:'Existing position protection checked',data:'Balance, quote, stop and broker quantity constraints checked'}
const accounts=computed(()=>accountStore.accounts.filter(a=>!a.isArchived))
let timer=null,hydrating=false,previewSequence=0
const label=d=>d.assetName?`${d.assetName} (${d.symbol})`:d.symbol
const assetLabel=computed(()=>form.value?label(form.value):'Planning')
const accountName=id=>accounts.value.find(a=>a.id===id)?.accountName||'Unassigned'
const playbookName=id=>playbooks.value.find(p=>p.id===id)?.name||'No playbook'
const statusLabel=s=>({draft:'Draft',watching:'Watching',ready:'Ready',cancelled:'Cancelled'}[s]||s)
function money(v,c){if(hideAmounts.value)return MONEY_MASK;if(v==null||v==='')return 'Unavailable';try{return new Intl.NumberFormat(undefined,{style:'currency',currency:c}).format(Number(v))}catch{return `${number(v)} ${c}`}}
function number(v){return v==null?'Unavailable':Number(v).toLocaleString(undefined,{maximumFractionDigits:6})}
const stage=i=>calculation.value?.stages[i]
const chosen=computed(()=>calculation.value?.stages.find(e=>e.key===chosenStage.value))
const runner=computed(()=>Math.max(0,100-(form.value?.exits||[]).reduce((s,e)=>s+(Number(e.percent)||0),0)))
const planCommitments=computed(()=>commitments.value.filter(c=>c.plan_id===selected.value?.id))
const locked=computed(()=>planCommitments.value.length>0)
const commitmentTotals=computed(()=>Object.entries(commitments.value.reduce((s,c)=>{s[c.currency]=(s[c.currency]||0)+Number(c.risk_amount);return s},{})))

const visiblePlans=computed(()=>{const selection=accountSelection(selectedAccount.value);return plans.value.filter(p=>{const a=accounts.value.find(a=>a.id===p.definition.accountId);const identifier=a?.accountIdentifier||a?.accountName;const matches=selection===null||selection.includes(identifier);return matches&&(draftFilter.value!=='unassigned'||!p.definition.accountId)&&(stageFilter.value==='all'||(stageFilter.value==='active'?!['cancelled','completed'].includes(p.status):p.status===stageFilter.value))})})
function defaults(){return {title:'New trade plan',symbol:'',assetName:'',instrument:'stock',direction:'long',accountId:null,currency:'GBP',playbookId:null,riskBudget:null,stopPrice:null,quantityStep:0.0001,pointSize:1,thesis:'',chartUrl:'',runnerEstimatePrice:null,runnerRule:'',exceptionReason:'',preparation:[{key:'setup',label:'Setup conditions and chart evidence reviewed',done:false},{key:'risk',label:'Stop, risk and sizing prepared',done:false},{key:'exit',label:'Exit-management rules prepared',done:false}],entries:[{key:'stage1',label:'Entry 1',price:null,riskWeight:100,tactic:''}],exits:[],options:{contract:'',type:'call',strike:null,expiry:null,premium:null,multiplier:100,contractDelta:null,atr:null,atrMultiplier:2,atrPeriod:14,atrTimeframe:'Daily',source:'',asOf:null}}}
function payload(){const d=JSON.parse(JSON.stringify(form.value));for(const k of ['riskBudget','stopPrice','runnerEstimatePrice'])if(d[k]==='')d[k]=null;d.symbol=d.symbol.trim().toUpperCase();for(const e of [...d.entries,...d.exits])if(e.price==='')e.price=null;for(const k of ['strike','premium','contractDelta','atr','expiry','asOf'])if(d.options[k]==='')d.options[k]=null;return d}
function failure(e){error.value=e.response?.data?.error||'Request failed. Your unsaved edits remain here.'}
async function load(){loading.value=true;try{const r=await api.get('/trade-plans');plans.value=r.data.plans;commitments.value=r.data.commitments}finally{loading.value=false}}
function adopt(p){cancelPending.value=false;hydrating=true;selected.value=p;form.value=JSON.parse(JSON.stringify(p.definition));calculation.value=p.calculation;chosenStage.value=form.value.entries[0].key;dirty.value=false;saveState.value='Saved';queueMicrotask(()=>hydrating=false)}
async function openPlan(p){if(dirty.value&&!confirm('Leave unsaved edits?'))return;clearTimeout(timer);error.value='';adopt(p);await router.replace(`/dashboard/planning/${p.id}`);try{history.value=(await api.get(`/trade-plans/${p.id}`)).data.history}catch(e){failure(e)}}
function newPlan(){cancelPending.value=false;if(dirty.value&&!confirm('Leave unsaved edits?'))return;clearTimeout(timer);hydrating=true;form.value=defaults();selected.value={id:null,status:'draft',version:0,definition:JSON.parse(JSON.stringify(form.value))};calculation.value=null;history.value=[];saveState.value='New draft · save to enable autosave';dirty.value=false;error.value='';router.replace('/dashboard/planning');queueMicrotask(()=>hydrating=false)}
function workspaceUpdated(p){selected.value=p;hydrating=true;form.value=JSON.parse(JSON.stringify(p.definition));calculation.value=p.calculation;dirty.value=false;load();queueMicrotask(()=>hydrating=false)}
function closeDetail(){if(dirty.value&&!confirm('Leave unsaved edits?'))return;clearTimeout(timer);selected.value=null;form.value=null;router.replace('/dashboard/planning')}
function chooseAccount(){const a=accounts.value.find(a=>a.id===form.value.accountId);if(a)form.value.currency=a.currency}
function useTemplate(){const p=playbooks.value.find(p=>p.id===form.value.playbookId);const t=p?.planningTemplate;if(!t)return;pendingTemplate.value=t}
function applyTemplate(){const t=pendingTemplate.value;if(!t)return;pendingTemplate.value=null;form.value.entries=t.entries.map(e=>({...e,price:null,tactic:e.tactic||''}));form.value.exits=t.exits.map(e=>({...e,price:null}));form.value.runnerRule=t.runnerRule||''}
function addEntry(){form.value.entries.push({key:crypto.randomUUID().replaceAll('-',''),label:`Entry ${form.value.entries.length+1}`,price:null,riskWeight:0,tactic:''})}
function addExit(){form.value.exits.push({key:crypto.randomUUID().replaceAll('-',''),label:`TP${form.value.exits.length+1}`,price:null,percent:0})}
async function calculatePreview(){const seq=++previewSequence;try{const r=await api.post('/trade-plans/calculate',{definition:payload()});if(seq===previewSequence)calculation.value=r.data.calculation}catch(e){failure(e)}}
async function save(){if(saving.value)return false;saving.value=true;error.value='';saveState.value='Saving…';const d=payload();try{const r=selected.value.id?await api.put(`/trade-plans/${selected.value.id}`,{definition:d,version:selected.value.version}):await api.post('/trade-plans',{definition:d});selected.value=r.data.plan;calculation.value=r.data.plan.calculation;dirty.value=JSON.stringify(payload())!==JSON.stringify(d);saveState.value=dirty.value?'Edits pending':'Saved';await load();if(dirty.value){clearTimeout(timer);timer=setTimeout(save,900)}return true}catch(e){failure(e);saveState.value='Save failed · edits retained';return false}finally{saving.value=false}}
async function setStatus(status){if(status==='cancelled'&&!cancelPending.value)return;if(dirty.value&&!(await save()))return;try{const r=await api.post(`/trade-plans/${selected.value.id}/status`,{status,version:selected.value.version,cancellationConfirmed:status==='cancelled'&&cancelPending.value});adopt(r.data.plan);await load()}catch(e){failure(e)}}
async function showEntryFeedback(){await nextTick();entryFeedback.value?.scrollIntoView?.({behavior:'smooth',block:'center'});entryFeedback.value?.focus?.({preventScroll:true});}
async function commit(stageKey){
  if(committing.value||locked.value)return;
  chosenStage.value=stageKey;commitError.value='';commitMessage.value='';error.value='';
  if(!Object.keys(checkLabels).every(k=>checks.value[k])){commitError.value='Complete all four entry checks before confirming the chosen entry.';await showEntryFeedback();return;}
  if(riskReason.value.trim().length<10){commitError.value='Record your manual portfolio/capacity verification reason (at least 10 characters). Automatic capacity checks are not connected yet.';await showEntryFeedback();return;}
  committing.value=true;let recorded=false;
  try{
    if(dirty.value&&!(await save())){commitError.value=error.value||'Save your plan before confirming this entry.';return;}
    await api.post(`/trade-plans/${selected.value.id}/commitments`,{stageKey:chosenStage.value,version:selected.value.version,checks:checks.value,riskOverrideReason:riskReason.value});
    recorded=true;await load();adopt(plans.value.find(p=>p.id===selected.value.id));saveState.value='Committed · awaiting execution confirmation';
    commitMessage.value='Chosen entry committed. Awaiting execution confirmation; no broker order was placed. Trade linking and management screens are currently available in the mockup only.';
  }catch(e){
    if(recorded)commitMessage.value='The entry commitment was recorded, but the display could not refresh. Reload the plan before trying again.';
    else {failure(e);commitError.value=error.value;}
  }finally{committing.value=false;await showEntryFeedback();}
}
async function release(c){if(!releaseConfirmed.value||!releaseReason.value.trim())return;const reason=releaseReason.value.trim();try{await api.post(`/trade-plans/${selected.value.id}/commitments/${c.id}/release`,{externalOrderNotLive:true,reason});await load();adopt(plans.value.find(p=>p.id===selected.value.id))}catch(e){failure(e)}}
watch(form,()=>{if(hydrating||!selected.value||locked.value)return;dirty.value=true;saveState.value=selected.value.id?'Edits pending':'New draft · save to enable autosave';clearTimeout(timer);if(selected.value.id)timer=setTimeout(save,900)},{deep:true})
watch(()=>form.value?.instrument,v=>{if(v==='option'&&!hydrating)form.value.quantityStep=1})
function leaving(e){if(dirty.value){e.preventDefault();e.returnValue=''}}
onMounted(async()=>{window.addEventListener('beforeunload',leaving);try{await Promise.all([load(),accountStore.fetchAccounts(),api.get('/playbooks').then(r=>playbooks.value=r.data.playbooks)]);if(route.params.id){const p=plans.value.find(p=>p.id===route.params.id);if(p)await openPlan(p);else error.value='Plan not found'}}catch(e){failure(e)}})
onBeforeUnmount(()=>{clearTimeout(timer);window.removeEventListener('beforeunload',leaving)})
</script>
<style scoped>th{text-align:left;color:#9ca3af;font-weight:500;white-space:nowrap}td,th{padding:12px 10px;border-bottom:1px solid #374151}td:first-child,th:first-child{padding-left:0}small{color:#9ca3af}input[type=checkbox]{accent-color:#f97316;width:18px;min-width:18px;height:18px}fieldset:disabled{opacity:.65}</style>