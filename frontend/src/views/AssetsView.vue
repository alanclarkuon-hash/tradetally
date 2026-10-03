<template>
  <div class="content-wrapper py-8 assets-page">
    <header class="mb-7"><p class="asset-eyebrow">ANALYSIS / ASSETS</p><h1 class="heading-page">Asset library</h1><p class="text-gray-500 dark:text-gray-400 mt-2">Explore the information TradeTally has saved about an asset.</p></header>
    <form @submit.prevent="search" class="asset-search">
      <div class="flex-1"><label for="asset-symbol" class="block text-sm font-medium mb-2">Asset symbol</label><input id="asset-symbol" v-model="input" placeholder="NEAR, NVDA or an exchange symbol such as SPXL.L" autocomplete="off" maxlength="30" class="input-field w-full" required /></div>
      <button class="btn-primary" :disabled="loading || !input.trim()">{{ loading ? 'Loading…' : 'View asset' }}</button>
    </form>
    <p class="text-xs text-gray-500 dark:text-gray-400 mt-3 mb-7">Saved information only. This page does not request new prices, enrichment or broker data. Values retain their stored currencies and dates.</p>
    <p v-if="error" role="alert" class="asset-notice">{{ error }}</p>
    <p v-if="loading" role="status" class="asset-notice">Reading saved asset details…</p>
    <template v-if="asset && !loading">
      <section class="asset-identity">
        <div><p class="asset-eyebrow">{{ asset.kind }}</p><h2>{{ asset.symbol }}</h2><p v-if="asset.name!==asset.symbol" class="mt-1 text-gray-500 dark:text-gray-400">{{ asset.name }}</p></div>
        <div class="text-right"><strong class="text-2xl tabular-nums">{{ asset.recordCount.toLocaleString() }}</strong><p class="text-sm text-gray-500 dark:text-gray-400">saved records</p></div>
      </section>
      <p v-if="asset.warning" class="asset-notice">{{ asset.warning }}</p>
      <section v-if="asset.labels.length" class="asset-labels">
        <h3>Categories & labels</h3><p class="text-xs text-gray-500 dark:text-gray-400 mb-4">{{ asset.labelSource }} · saved {{ date(asset.labelAsOf) }}</p>
        <div class="flex flex-wrap gap-2"><span v-for="label in asset.labels" :key="label" class="asset-chip">{{ label }}</span></div>
      </section>
      <p v-else class="asset-notice">No saved category labels for this asset yet.</p>
      <details v-if="asset.cachedProfile" class="asset-section"><summary>Saved Yahoo Finance identity</summary><dl class="asset-fields"><div v-for="(value,key) in asset.cachedProfile" :key="key"><dt>{{ label(key) }}</dt><dd><AssetDataValue :value="value" /></dd></div></dl></details>
      <p v-if="!asset.recordCount && !asset.labels.length && !asset.cachedProfile" class="asset-notice">No saved details found for {{ asset.symbol }}. Check the symbol and exchange suffix. This does not mean the asset does not exist.</p>
      <div class="asset-layout">
        <nav class="asset-index" aria-label="Saved information sections"><h3>Saved information</h3><a v-for="section in populated" :key="section.key" :href="'#asset-'+section.key">{{ section.title }} <span>{{ section.count.toLocaleString() }}</span></a></nav>
        <div class="min-w-0 space-y-4">
          <section v-for="section in populated" :key="section.key" :id="'asset-'+section.key" class="asset-section">
            <header class="flex items-center justify-between gap-4"><h3>{{ section.title }}</h3><span class="text-xs text-gray-500 dark:text-gray-400">{{ section.count.toLocaleString() }} records</span></header>
            <details v-for="(record,index) in section.records" :key="section.offset+index" class="asset-record" :open="section.count===1">
              <summary><span>Record {{ section.offset+index+1 }}</span><span class="text-gray-500 dark:text-gray-400">{{ recordDate(record) }}</span></summary>
              <dl class="asset-fields"><div v-for="(value,key) in record" :key="key"><dt>{{ label(key) }}</dt><dd><AssetDataValue :value="value" /></dd></div></dl>
            </details>
            <div v-if="section.count>25" class="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm"><span>{{ section.offset+1 }}–{{ Math.min(section.offset+25,section.count) }} of {{ section.count }}</span><div class="flex gap-2"><button class="btn-secondary" :disabled="pageLoading===section.key || !section.offset" @click="page(section,-25)">Previous</button><button class="btn-secondary" :disabled="pageLoading===section.key || section.offset+25>=section.count" @click="page(section,25)">Next</button></div></div>
          </section>
          <details class="asset-section"><summary>Information not stored</summary><p class="text-sm text-gray-500 dark:text-gray-400 mt-3">{{ empty.map(s=>s.title).join(' · ') || 'Every listed source contains records.' }}</p></details>
        </div>
      </div>
    </template>
    <p v-else-if="!loading" class="asset-placeholder">Start with a symbol to open its saved profile, classifications, prices, financials, news and your activity.</p>
  </div>
</template>
<script setup>
import {ref,computed} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import api from '@/services/api'
import AssetDataValue from '@/components/AssetDataValue.vue'
const route=useRoute(),router=useRouter(),input=ref(String(route.query.symbol||'')),asset=ref(null),loading=ref(false),error=ref(''),pageLoading=ref('')
const populated=computed(()=>asset.value?.sections.filter(s=>s.count)||[]),empty=computed(()=>asset.value?.sections.filter(s=>!s.count)||[])
const label=key=>String(key).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())
const date=value=>value?new Date(value).toLocaleString():'date unavailable'
const recordDate=r=>date(r.updated_at||r.fetched_at||r.last_updated||r.synced_at||r.analysis_date||r.price_date||r.entry_time||r.payment_date||r.added_at||r.purchase_date||r.split_date||r.ts||r.timestamp||r.last_checked_at||r.created_at)
async function search(){
  loading.value=true;error.value='';asset.value=null
  const symbol=input.value.trim().toUpperCase()
  try {asset.value=(await api.get('/investments/assets/'+encodeURIComponent(symbol))).data;input.value=symbol;await router.replace({query:{symbol}})}
  catch(e){error.value=e.response?.data?.error||e.response?.data?.message||'Unable to read saved asset details.'}
  finally{loading.value=false}
}
async function page(section,delta){
  pageLoading.value=section.key;error.value=''
  const symbol=asset.value.symbol
  try{const result=(await api.get('/investments/assets/'+encodeURIComponent(symbol),{params:{source:section.key,offset:section.offset+delta}})).data;if(asset.value?.symbol===symbol)Object.assign(section,result)}
  catch{error.value='Unable to load this page of saved records.'}
  finally{pageLoading.value=''}
}
if(input.value)search()
</script>
<style>
.assets-page{max-width:1440px}.asset-eyebrow{font-size:10px;letter-spacing:.16em;color:#718d86;font-weight:700;margin-bottom:8px}.asset-search{display:flex;align-items:end;gap:16px;padding:24px;border:1px solid #718d8633;border-radius:10px;background:#718d8608}.asset-identity{display:flex;justify-content:space-between;align-items:center;padding:28px 0;border-top:2px solid #75b49c;margin-bottom:12px}.asset-identity h2{font-size:36px;letter-spacing:-.04em;font-weight:650}.asset-labels{padding:20px 0 28px}.assets-page h3{font-size:16px;font-weight:600;margin-bottom:8px}.asset-chip{padding:6px 10px;border:1px solid #718d8655;border-radius:5px;font-size:12px}.asset-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:28px;margin-top:24px}.asset-index{align-self:start;position:sticky;top:70px}.asset-index a{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #718d8622;font-size:12px}.asset-index span{color:#718d86;font-variant-numeric:tabular-nums}.asset-section{border:1px solid #718d8633;border-radius:8px;padding:20px;scroll-margin-top:90px}.asset-record{padding:12px 0;border-top:1px solid #718d8622}.asset-record summary{display:flex;justify-content:space-between;gap:12px;cursor:pointer;font-size:12px}.asset-record summary:before{content:'▸';color:#718d86}.asset-record[open] summary:before{content:'▾'}.asset-fields{margin-top:16px;font-size:12px}.asset-fields>div{display:grid;grid-template-columns:minmax(100px,190px) minmax(0,1fr);gap:16px;padding:9px 0;border-top:1px solid #718d861a}.asset-fields dt{color:#718d86;overflow-wrap:anywhere}.asset-fields dd{min-width:0;overflow-wrap:anywhere}.asset-notice{padding:14px 18px;border-left:3px solid #718d86;background:#718d860d;margin:16px 0;font-size:13px}.asset-placeholder{padding:64px 20px;text-align:center;color:#718d86}.nested-data summary{cursor:pointer}.assets-page summary:focus-visible,.asset-index a:focus-visible{outline:2px solid #75b49c;outline-offset:3px}@media(max-width:800px){.asset-layout{grid-template-columns:1fr}.asset-index{position:static}.asset-search{flex-direction:column;align-items:stretch}.asset-fields>div{grid-template-columns:1fr;gap:4px}}
</style>
<style>.asset-search input{background:transparent;color:inherit;border:1px solid #718d8655;border-radius:6px;padding:12px 14px;min-height:48px}.asset-search input:focus{outline:2px solid #75b49c;outline-offset:2px}.asset-search input::placeholder{color:#81948f}</style>
