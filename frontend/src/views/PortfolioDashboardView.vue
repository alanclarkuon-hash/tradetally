<template>
  <div class="content-wrapper py-8 portfolio-page">
    <nav class="flex gap-7 mb-7 border-b border-gray-200 dark:border-gray-700" aria-label="Dashboard tabs"><RouterLink to="/dashboard" class="pb-3 text-gray-500 dark:text-gray-400">Trading</RouterLink><RouterLink to="/dashboard/portfolio" class="pb-3 border-b-2 border-primary-500 text-primary-600 dark:text-primary-400" aria-current="page">Portfolio</RouterLink></nav>
    <header class="portfolio-header">
      <div><h1 class="heading-page">Portfolio</h1><p class="subtitle">Combined holdings, cash and portfolio performance</p></div>
      <div class="controls">
        <details ref="accountPicker" class="account-picker"><summary aria-label="Accounts filter" :title="selected.length ? `${selected.length} accounts selected` : 'All accounts'"><BuildingOfficeIcon class="h-5 w-5" aria-hidden="true" /><span v-if="selected.length" class="filter-dot" aria-hidden="true"></span><ChevronDownIcon class="h-4 w-4" aria-hidden="true" /></summary><div class="account-menu"><button @click="selectAllAccounts">Select all accounts</button><label v-for="account in accounts" :key="account.value"><input type="checkbox" :checked="!selected.length || selected.includes(account.value)" @change="toggleAccount(account.value,$event.target.checked)">{{ account.label }}</label></div></details>
        <details ref="periodPicker" class="period-picker">
          <summary aria-label="Date range filter" :title="periodLabel">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18M6 8h12M10 12h4M11 16h2" /></svg>
            <span v-if="period!=='all'" class="date-filter-dot" aria-hidden="true"></span>
          </summary>
          <div class="period-menu" aria-label="Date ranges"><button v-for="option in timeRangeOptions" :key="option.value" type="button" :class="{active:period===option.value}" :aria-pressed="period===option.value" :data-period="option.value" @click="selectPeriod(option.value)">{{ option.label }}</button></div>
        </details>
        <label class="sr-only" for="portfolio-currency">Display currency</label><select id="portfolio-currency" v-model="currency"><option value="GBP">£</option><option value="USD">$</option></select>
        <button @click="load" :disabled="loading" class="refresh">{{ loading ? 'Loading…' : 'Refresh' }}</button>
      </div>
    </header>
    <div v-if="period==='custom'" class="custom-dates"><label>From <input type="date" v-model="start" :max="end"></label><label>To <input type="date" v-model="end" :min="start" :max="today"></label></div>
    <p v-if="error" role="alert" class="coverage">{{ error }}</p>
    <p v-if="loading" role="status" class="coverage">Loading balances and price history…</p>
    <template v-if="data && !loading">
      <section class="value-row" aria-label="Portfolio totals">
        <article class="card-dense value-card"><p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ incomplete ? 'Known portfolio value' : 'Combined portfolio value' }}</p><div class="money main-money">{{ money(data.totals.portfolioValue) }}</div><p class="card-foot">Latest · {{ data.accountCount }} accounts · {{ currency }}</p></article>
        <article class="card-dense value-card"><p class="text-sm font-medium text-gray-500 dark:text-gray-400">Holdings value</p><div class="money">{{ money(data.totals.holdingsValue) }}</div></article>
        <article class="card-dense value-card"><p class="text-sm font-medium text-gray-500 dark:text-gray-400">Cash &amp; stablecoins</p><div class="money">{{ money(data.totals.cashValue+data.totals.stablecoinValue) }}</div><p class="card-foot">Cash {{ money(data.totals.cashValue) }} <span class="muted">· Stablecoins {{ money(data.totals.stablecoinValue) }}</span></p></article>
      </section>
      <section class="card-dense allocation" aria-label="Invested allocation">
        <div class="section-line"><h2>Capital at work</h2><p><strong>{{ allocation[0].percent.toFixed(1) }}%</strong> invested</p></div>
        <div class="allocation-track"><div v-for="part in allocation" :key="part.name" :style="{width:part.percent+'%',background:part.color}" :title="`${part.name}: ${money(part.value)}`"></div></div>
        <div class="allocation-legend"><span v-for="part in allocation" :key="part.name"><i :style="{background:part.color}"></i>{{ part.name }} <strong>{{ money(part.value) }}</strong><small>{{ part.percent.toFixed(1) }}%</small></span></div>
      </section>
    <PortfolioValueChart :history="history" :loading="historyLoading" :error="historyError" :currency="currency" :unrealized-change="data.totals.pnl ?? data.totals.knownPnl" :missing-pnl-symbols="data.coverage.missingPnlSymbols || []" />
    <section class="card-dense heatmap-section">
        <div class="section-line"><div><h2>Inside your holdings</h2><p class="subtitle">Stocks → Sector → Industry · area shows value · colour shows holdings P&amp;L</p></div><div class="color-key"><span>Loss</span><i></i><span>Gain</span><span class="no-history">■ No history</span></div></div>
        <p v-if="data.coverage.classificationOverrideWarning" class="coverage" role="alert">{{ data.coverage.classificationOverrideWarning }}</p>
        <div v-if="groups.length" class="heatmap" aria-label="Holdings heatmap">
          <div v-for="group in groups" :key="group.name" class="industry" :style="rectStyle(group,true)"><div class="industry-label" :title="group.name">{{ group.name }} <span>{{ money(group.value) }}</span></div><div class="industry-tiles">
            <div v-for="sector in group.sectors" :key="sector.name" :style="{left:sector.x+'%',top:sector.y+'%',width:sector.w+'%',height:sector.h+'%'}" class="stock-sector" :title="sector.name"><span :style="{height:sector.labelHeight+'%'}">{{ sector.name }}</span></div>
            <template v-for="category in group.categories" :key="category.key||category.name"><div v-if="category.showLabel" :style="{left:category.x+'%',top:category.y+'%',width:category.w+'%',height:category.labelHeight+'%'}" class="crypto-category-label" :title="category.name">{{ category.name }}</div></template>
            <button v-for="tile in group.tiles" :key="tile.symbol" class="holding-tile" :style="{...rectStyle(tile),background:pnlColor(tile.pnlPercent),color:tile.pnlPercent>=20?'#102d20':'#f5fff8'}" @mouseenter="focus=tile" @focus="focus=tile" @click="focus=tile" :aria-label="`${tile.symbol}, ${money(tile.value)}, ${percent(tile.pnlPercent)}`" :title="`${tile.symbol}${tile.name ? ' · '+tile.name : ''} · ${money(tile.value)} · ${percent(tile.pnlPercent)}`">
              <template v-if="tile.area>1700"><span class="ticker" :style="{fontSize:Math.max(10,Math.min(25,tile.pixelW/5))+'px'}">{{ tile.symbol }}</span><span class="tile-pnl">{{ percent(tile.pnlPercent) }}</span><span v-if="tile.area>10000" class="tile-value">{{ money(tile.value) }}</span></template><span v-else class="tiny-ticker">{{ tile.symbol }}</span>
            </button>
          </div></div>
        </div><p v-else class="empty">No priced holdings for these accounts.</p>
        <div class="holding-detail" aria-live="polite"><template v-if="focus"><strong>{{ focus.symbol }}</strong><span v-if="focus.name">{{ focus.name }}</span><span>{{ focus.sector ? `${focus.sector} → ` : '' }}{{ focus.industry }}</span><span>Value <b>{{ money(focus.value) }}</b></span><span :class="pnlClass(focus.pnl)">P&amp;L <b>{{ signedMoney(focus.pnl) }} · {{ percent(focus.pnlPercent) }}</b></span></template><span v-else>Hover over or select a holding to see its details.</span></div>
        <details v-if="focus?.categories?.length" class="coverage"><summary>{{ focus.categorySource }} labels for {{ focus.symbol }} ({{ focus.categories.length }}){{ focus.categoryStale ? ' · cached labels' : '' }}</summary><div class="flex flex-wrap gap-2 mt-3"><span v-for="category in focus.categories" :key="category" class="px-2 py-1 rounded border border-gray-500/30">{{ category }}</span></div></details>
        <p v-if="focus?.categoryOverride" class="coverage">Manual grouping correction: {{ focus.categoryOverride.override_reason }} <a :href="focus.categoryOverride.source_url" target="_blank" rel="noopener noreferrer" class="underline">Review source</a></p>
        <p class="scope-note">Stocks use FinanceDatabase sector and industry classifications, which are community reference data and may be outdated or incorrect. Funds & ETFs use Yahoo Finance categories; crypto uses CoinGecko themes with AI taking priority. Your correction files take precedence for all three asset classes.</p>
      </section>
      <div v-if="incomplete || data.coverage.missingPnl || data.coverage.unclassified" class="coverage"><strong>Data coverage</strong> <span v-if="data.coverage.missingCash"> {{ data.coverage.missingCash }} accounts lack a verified cash balance.</span><span v-if="data.coverage.missingPrices"> {{ data.coverage.missingPrices }} holdings lack a price.</span><span v-if="data.coverage.missingPnl"> {{ data.coverage.missingPnl }} holdings lack reliable P&amp;L for this range; their tiles are grey.</span><span v-if="data.coverage.unclassified"> {{ data.coverage.unclassified }} holdings have no industry classification.</span></div>
      <p class="updated">View refreshed {{ new Date(data.asOf).toLocaleString() }}. Broker balances and quotes may have different timestamps.</p>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import api from '@/services/api'
import { BuildingOfficeIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import { resolveDatePreset, monthPresetOptions } from '@/utils/datePresets'
import { formatLocalDate } from '@/utils/date'
import { useGlobalAccountFilter } from '@/composables/useGlobalAccountFilter'
import { holdingGroups, pnlColor, heatmapRectStyle as rectStyle } from '@/utils/portfolioTreemap'
import PortfolioValueChart from '@/components/dashboard/PortfolioValueChart.vue'
const {accounts,selectedAccount,fetchAccounts}=useGlobalAccountFilter()
const selected=ref(selectedAccount.value?[selectedAccount.value]:[]),period=ref('all'),currency=ref('GBP'),data=ref(null),loading=ref(false),error=ref(''),focus=ref(null)
const today=formatLocalDate(new Date()),start=ref(today.slice(0,4)+'-01-01'),end=ref(today)
const periodPicker=ref(null),accountPicker=ref(null)
function selectAllAccounts(){selected.value=accounts.value.map(account=>account.value)}
function toggleAccount(value,checked){
  const current=selected.value.length?selected.value:accounts.value.map(account=>account.value)
  selected.value=checked?[...new Set([...current,value])]:current.filter(account=>account!==value)
}
function dismissFilters(event){
  for(const picker of [accountPicker.value,periodPicker.value]){
    if(picker && !picker.contains(event.target))picker.open=false
  }
}
function dismissOnEscape(event){if(event.key==='Escape'){for(const picker of [accountPicker.value,periodPicker.value]){if(picker?.open){picker.open=false;picker.querySelector('summary')?.focus()}}}}
onMounted(()=>{document.addEventListener('pointerdown',dismissFilters);document.addEventListener('keydown',dismissOnEscape)})
onUnmounted(()=>{document.removeEventListener('pointerdown',dismissFilters);document.removeEventListener('keydown',dismissOnEscape)})
const timeRangeOptions=[...monthPresetOptions,{value:'all',label:'All Time'},{value:'7d',label:'Last 7 Days'},{value:'30d',label:'Last 30 Days'},{value:'ytd',label:'Year to Date'},{value:'custom',label:'Custom Range'}]
const periodLabel=computed(()=>timeRangeOptions.find(option=>option.value===period.value)?.label || 'All Time')
function selectPeriod(value){period.value=value;if(periodPicker.value)periodPicker.value.open=false}
let request=0
const history=ref(null),historyLoading=ref(false),historyError=ref('')
const money=v=>v==null?'Unavailable':new Intl.NumberFormat('en-GB',{style:'currency',currency:currency.value,maximumFractionDigits:2}).format(v)
const signedMoney=v=>v==null?'Period change unavailable':`${v>=0?'+':'−'}${money(Math.abs(v))}`
const percent=v=>v==null?'Unavailable':`${v>=0?'+':''}${Number(v).toFixed(2)}%`
const pnlClass=v=>v==null?'muted':v>=0?'gain':'loss'
const incomplete=computed(()=>data.value&&(data.value.coverage.missingCash||data.value.coverage.missingPrices))
const allocation=computed(()=>{const t=data.value.totals;return [{name:'Invested',value:t.holdingsValue,color:'#73c6a1'},{name:'Cash',value:t.cashValue,color:'#9aaabd'},{name:'Stablecoins',value:t.stablecoinValue,color:'#c9b274'}].map(p=>({...p,percent:t.portfolioValue>0?p.value/t.portfolioValue*100:0}))})
const groups=computed(()=>holdingGroups(data.value?.holdings||[]))
async function load(){
  const id=++request;loading.value=true;error.value='';focus.value=null;history.value=null;historyLoading.value=true;historyError.value=''
  const params={currency:currency.value,accounts:selected.value.join(',')}
  if(period.value!=='all'){
    Object.assign(params,period.value==='custom'?{start_date:start.value,end_date:end.value}:resolveDatePreset(period.value))
  }
  try{const response=await api.get('/investments/portfolio/dashboard',{params,timeout:180000});if(id===request)data.value=response.data}
  catch(e){if(id===request){error.value=e.response?.data?.error||'Could not load portfolio';data.value=null}}
  finally{if(id===request)loading.value=false}
  if(id!==request)return
  if(!data.value){historyLoading.value=false;return}
  try{
    await api.post('/investments/portfolio/value-history/capture',{accounts:params.accounts},{timeout:180000})
    const response=await api.get('/investments/portfolio/value-history',{params,timeout:180000})
    if(id===request)history.value=response.data
  }catch(e){if(id===request)historyError.value=e.response?.data?.error||'Portfolio history is unavailable. Current balances are still shown above.'}
  finally{if(id===request)historyLoading.value=false}
}
watch(selectedAccount,v=>selected.value=v?[v]:[])
watch([selected,period,currency,start,end],load,{deep:true})
onMounted(async()=>{await fetchAccounts();load()})
</script>

<style scoped>
.portfolio-header,.section-line{display:flex;justify-content:space-between;align-items:center;gap:20px}
.portfolio-header{margin-bottom:32px}
.subtitle,.scope-note,.updated{@apply text-sm text-gray-600 dark:text-gray-400; margin-top:4px}
.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.controls select,.custom-dates input{@apply border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm; padding:8px 12px;min-height:40px}
.refresh,.account-picker summary,.period-picker summary{@apply border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700; padding:8px 12px;min-height:40px;cursor:pointer}
.refresh:disabled{opacity:.5;cursor:wait}
.controls select:focus-visible,.refresh:focus-visible,.account-picker summary:focus-visible,.period-picker summary:focus-visible,.custom-dates input:focus-visible{@apply outline-none ring-2 ring-primary-500}
.account-picker,.period-picker{position:relative}
.account-picker summary,.period-picker summary{display:flex;align-items:center;justify-content:center;gap:8px;list-style:none}
.account-picker summary::-webkit-details-marker,.period-picker summary::-webkit-details-marker{display:none}
.period-picker summary{width:40px;height:40px;padding:0;position:relative}
.filter-dot,.date-filter-dot{@apply bg-primary-500; width:8px;height:8px;border-radius:50%}
.date-filter-dot{@apply ring-2 ring-white dark:ring-gray-900;position:absolute;top:-2px;right:-2px}
.period-menu{@apply bg-white dark:bg-gray-800 shadow-lg rounded-md;position:absolute;right:0;top:44px;z-index:30;width:176px;padding:4px 0}
.period-menu button{@apply text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700;display:block;width:100%;text-align:left;padding:8px 16px;font-size:14px}
.period-menu button.active{@apply bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300}
.period-menu button:focus-visible{@apply outline-none ring-2 ring-inset ring-primary-500}
.account-menu{@apply bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg;position:absolute;right:0;top:44px;z-index:30;padding:12px;min-width:260px;max-height:360px;overflow:auto}
.account-menu label{display:flex;gap:10px;padding:8px;font-size:14px}
.account-menu button{@apply text-primary-600 dark:text-primary-400; padding:8px;font-size:14px}
.value-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.value-card{padding:20px}
.money{@apply text-gray-900 dark:text-white; font-size:30px;font-weight:600;margin:10px 0;font-variant-numeric:tabular-nums}
.card-foot{font-size:12px;line-height:1.6}
.muted{@apply text-gray-500 dark:text-gray-400}
.gain{@apply text-green-600 dark:text-green-400}
.loss{@apply text-red-600 dark:text-red-400}
.scope-note{margin:12px 0 24px;line-height:1.6}
.allocation{padding:20px;margin:24px 0}
.section-line h2{@apply text-base sm:text-lg font-semibold text-gray-900 dark:text-white}
.section-line p{@apply text-sm text-gray-600 dark:text-gray-400}
.allocation-track{height:12px;display:flex;overflow:hidden;border-radius:3px;background:#394451;margin:16px 0}
.allocation-legend{@apply text-gray-700 dark:text-gray-300;display:flex;gap:30px;flex-wrap:wrap;font-size:12px}
.allocation-legend span{display:flex;align-items:center;gap:7px}
.allocation-legend i{width:8px;height:8px;border-radius:50%}
.allocation-legend small{@apply text-gray-500 dark:text-gray-400}
.heatmap-section{padding:20px}
.heatmap{position:relative;height:560px;background:#0e151c;margin-top:18px;border:3px solid #0e151c;border-radius:6px;overflow:hidden}.industry{position:absolute;padding:2px;overflow:hidden}.industry-label{height:24px;display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:600;color:#cbd5df;white-space:nowrap;overflow:hidden;background:#0e151c;padding:0 5px;gap:10px}.industry-label span{color:#8496a9;font-weight:400}.industry-tiles{position:relative;height:calc(100% - 24px)}.holding-tile{position:absolute;border:1px solid #0e151c;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#f5fff8;overflow:hidden;transition:filter .15s}.holding-tile:hover,.holding-tile:focus-visible{filter:brightness(1.2);outline:2px solid #e0edff;outline-offset:-3px;z-index:2}.ticker{font-weight:700;letter-spacing:-.02em}.tile-pnl{font-size:13px;font-weight:600}.tile-value{font-size:10px;opacity:.8}.tiny-ticker{font-size:9px;font-weight:600}.color-key{display:flex;gap:6px;align-items:center;font-size:10px;@apply text-gray-500 dark:text-gray-400}.color-key i{width:85px;height:7px;background:linear-gradient(90deg,#8b1226,#394451,#77da9b);border-radius:2px}.no-history{margin-left:8px}.holding-detail{display:flex;gap:24px;flex-wrap:wrap;min-height:48px;align-items:center;border-bottom:1px solid #71809633;font-size:12px;@apply text-gray-600 dark:text-gray-400}.holding-detail strong{@apply text-primary-600 dark:text-primary-400}.coverage{@apply bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 rounded-lg; font-size:13px;padding:12px;margin-top:16px;line-height:1.8}.updated{margin:16px 0}.custom-dates{display:flex;gap:15px;justify-content:flex-end;margin-bottom:18px;font-size:12px}.empty{@apply text-gray-500 dark:text-gray-400; padding:60px;text-align:center}@media(max-width:900px){.portfolio-header,.section-line{align-items:flex-start;flex-direction:column}.value-row{grid-template-columns:1fr}.heatmap{height:480px}.money,.main-money{font-size:30px}.allocation-legend{gap:12px}.industry-label span{display:none}}@media(prefers-reduced-motion:reduce){.holding-tile{transition:none}}
</style>



<style scoped>.crypto-category-label{position:absolute;height:18px;line-height:18px;background:#19222c;color:#afbecd;font-size:9px;white-space:nowrap;overflow:hidden;padding:0 4px;border:1px solid #0e151c;pointer-events:none;z-index:1}.stock-sector{position:absolute;border:1px solid #8290a155;pointer-events:none;z-index:1;overflow:hidden}.stock-sector span{display:block;height:22px;line-height:22px;background:#24313b;color:#e0edf0;font-size:10px;font-weight:600;padding:0 5px;white-space:nowrap;overflow:hidden}</style>
