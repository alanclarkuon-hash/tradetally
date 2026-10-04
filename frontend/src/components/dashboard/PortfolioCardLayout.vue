<template>
  <p v-if="!customizing && !layout.some(card=>card.visible)" class="card-dense p-6 text-gray-600 dark:text-gray-400">All portfolio cards are hidden. Use the gear to show cards or reset the layout.</p>
  <draggable v-model="layout" item-key="id" handle=".drag-handle" :disabled="!customizing" class="portfolio-card-layout" :animation="150" :scroll="true" :scroll-sensitivity="80" :scroll-speed="12">
    <template #item="{element,index}">
      <div :data-card="element.id" :class="['portfolio-card-item',{'wide-card':element.wide,'hidden-card':!element.visible&&!customizing}]">
        <div v-if="customizing" class="card-controls" :class="{'opacity-50':!element.visible}">
          <button type="button" class="drag-handle" :aria-label="`Drag ${element.title} to reorder`" title="Drag to reorder"><svg class="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><circle v-for="point in [[7,5],[13,5],[7,10],[13,10],[7,15],[13,15]]" :key="point.join(',')" :cx="point[0]" :cy="point[1]" r="1.5" /></svg><span>{{ element.title }}</span></button>
          <div class="flex items-center gap-1">
            <button type="button" :disabled="index===0" :aria-label="`Move ${element.title} up`" @click="move(index,-1)"><ArrowUpIcon class="w-4 h-4" /></button>
            <button type="button" :disabled="index===layout.length-1" :aria-label="`Move ${element.title} down`" @click="move(index,1)"><ArrowDownIcon class="w-4 h-4" /></button>
            <button type="button" :aria-label="`${element.visible?'Hide':'Show'} ${element.title}`" :aria-pressed="element.visible" class="visibility-toggle" @click="element.visible=!element.visible"><component :is="element.visible?EyeIcon:EyeSlashIcon" class="w-4 h-4" /><span>{{ element.visible?'Visible':'Hidden' }}</span></button>
          </div>
        </div>
        <slot v-if="element.visible" :name="element.id" />
      </div>
    </template>
  </draggable>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import draggable from 'vuedraggable'
import { ArrowUpIcon, ArrowDownIcon, EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import { useUiPreferencesStore } from '@/stores/uiPreferences'
const props=defineProps({customizing:Boolean})
const preferences=useUiPreferencesStore()
const key='portfolioDashboardLayout'
const defaults=[
  {id:'total',title:'Combined portfolio value'},
  {id:'holdings',title:'Holdings value'},
  {id:'cash',title:'Cash & stablecoins'},
  {id:'allocation',title:'Capital at work',wide:true},
  {id:'history',title:'Portfolio Value',wide:true},
  {id:'heatmap',title:'Inside your holdings',wide:true}
]
const fresh=()=>defaults.map(card=>({...card,visible:true}))
const layout=ref(fresh())
let ready=false
function restore(saved){
  const found=new Set(),cards=[]
  for(const entry of Array.isArray(saved)?saved:[]){
    const definition=defaults.find(card=>card.id===entry?.id)
    if(definition&&!found.has(entry.id)){cards.push({...definition,visible:entry.visible!==false});found.add(entry.id)}
  }
  return [...cards,...fresh().filter(card=>!found.has(card.id))]
}
function move(index,offset){const cards=[...layout.value];const [card]=cards.splice(index,1);cards.splice(index+offset,0,card);layout.value=cards}
function reset(){layout.value=fresh()}
watch(layout,cards=>{
  if(!ready)return
  const saved=cards.map(({id,visible})=>({id,visible}))
  localStorage.setItem(key,JSON.stringify(saved))
  preferences.notifyChanged(key,saved)
},{deep:true})
onMounted(async()=>{
  await preferences.init()
  try{layout.value=restore(JSON.parse(localStorage.getItem(key)))}catch{layout.value=fresh()}
  ready=true
})
defineExpose({reset})
</script>

<style scoped>
.portfolio-card-layout{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px 16px}
.portfolio-card-item{min-width:0;display:flex;flex-direction:column}.wide-card{grid-column:1/-1}.hidden-card{display:none}
.card-controls{@apply bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-600 dark:text-gray-300;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;margin-bottom:6px;font-size:12px}
.card-controls button{display:inline-flex;align-items:center;gap:4px;padding:4px;border-radius:4px}.card-controls button:hover{@apply bg-gray-200 dark:bg-gray-700}.card-controls button:focus-visible{@apply outline-none ring-2 ring-primary-500}.card-controls button:disabled{opacity:.3}.drag-handle{cursor:grab}.drag-handle:active{cursor:grabbing}.visibility-toggle{@apply text-primary-600 dark:text-primary-400}.sortable-ghost{opacity:.35}
.portfolio-card-item :deep(.value-card){flex:1}
@media(max-width:1100px){.card-controls{flex-wrap:wrap}}
@media(max-width:900px){.portfolio-card-layout{grid-template-columns:1fr}}
</style>
