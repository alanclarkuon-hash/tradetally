<template>
  <section class="card-dense portfolio-history" aria-labelledby="portfolio-history-title">
    <div class="history-heading">
      <div><h2 id="portfolio-history-title" class="heading-card">{{ includeFunding ? "Portfolio Value" : "Portfolio gains" }}</h2><p>{{ includeFunding ? "Investments, cash and stablecoins" : "Overall gains excluding deposits & withdrawals" }}</p></div>
      <div class="history-change"><strong v-if="!loading && !error && displayedChange!=null" :class="displayedChange>=0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">{{ signedMoney(displayedChange) }}</strong><span v-else>{{ loading ? 'Loading change…' : 'Change unavailable' }}</span><small v-if="!includeFunding">Includes realised gains, income and fees</small><label class="funding-toggle"><input type="checkbox" v-model="includeFunding" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"> Include deposits &amp; withdrawals</label></div>
    </div>
    <p v-if="loading" class="history-message" role="status">Loading portfolio history…</p>
    <p v-else-if="error" class="history-message" role="status">{{ error }}</p>
    <template v-else-if="history">
      <div v-if="!completePoints.length" class="history-message" role="status">
        <p>{{ includeFunding ? 'No complete combined portfolio values are available for this range.' : 'Overall gains cannot be calculated from the available balances and funding data.' }}</p>
        <p v-if="accountsWithoutValues.length">No dated values in this range for: {{ accountsWithoutValues.join(', ') }}.</p>
        <p>Choose a range with recorded balances. For recent dates, run a broker sync to collect fresh dated balances.</p>
        <p v-if="isTestEnvironment">Automatic broker syncs are off in this test environment.</p>
        <ul v-if="history.captureWarnings?.length" class="mt-2 list-disc pl-5"><li v-for="warning in history.captureWarnings" :key="warning">{{ warning }}</li></ul>
      </div>
      <template v-else>
      <p v-if="completePoints.length===1" class="history-message" role="status">Only one complete value is available in this range. A second is needed to calculate period change.</p>
      <div class="history-legend"><span><i class="value-key"></i>{{ includeFunding ? "Portfolio value" : "Overall gains" }}</span><span class="deposit-key">▲ Deposit</span><span class="withdrawal-key">▼ Withdrawal</span><span>◆ Transfer</span></div>
      <div class="history-canvas"><canvas ref="canvas" role="img" :aria-label="includeFunding ? 'Recorded portfolio values and funding activity over time.' : 'Overall portfolio gains excluding cash funding over time.'" /></div>
      </template>
    </template>
  </section>
</template>

<script setup>
import {ref,computed,watch,onBeforeUnmount,nextTick} from 'vue'
import {Chart} from '@/lib/chartSetup'
import {useMonetaryPrivacy,MONEY_MASK} from '@/composables/useDashboardPrivacy'
const {hideAmounts}=useMonetaryPrivacy()
import {dateNumber,valueChartPoints,fundingAdjustedHistory} from '@/utils/portfolioValueChart'


const props=defineProps({history:Object,loading:Boolean,error:String,currency:{type:String,default:'GBP'}})
const includeFunding=ref(true)
const adjusted=computed(()=>fundingAdjustedHistory(props.history))
const displayedSeries=computed(()=>includeFunding.value ? props.history?.series||[] : adjusted.value.series||[])
const completePoints=computed(()=>displayedSeries.value.filter(point=>point.value!=null && Number.isFinite(Number(point.value))))
const accountsWithoutValues=computed(()=>(props.history?.coverage?.accounts||[]).filter(account=>!account.days).map(account=>account.name))
const isTestEnvironment=window.__APP_CONFIG__?.APP_ENVIRONMENT==='test'
const displayedChange=computed(()=>includeFunding.value ? props.history?.change : adjusted.value.change)
const canvas=ref(null)
let chart=null
const money=value=>hideAmounts.value?MONEY_MASK:value==null?'Unavailable':new Intl.NumberFormat('en-GB',{style:'currency',currency:props.currency,maximumFractionDigits:2}).format(value)
const signedMoney=value=>hideAmounts.value?MONEY_MASK:(value>=0?'+':'−')+money(Math.abs(value))
const nativeMoney=event=>hideAmounts.value?(event.crypto?`${MONEY_MASK} ${event.asset}`:MONEY_MASK):event.crypto ? `${event.quantity.toLocaleString('en-GB',{maximumFractionDigits:10})} ${event.asset}` : new Intl.NumberFormat('en-GB',{style:'currency',currency:event.nativeCurrency}).format(event.nativeAmount)
const dateLabel=date=>date?new Date(dateNumber(date)).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'Unavailable'
async function render() {
  await nextTick()
  chart?.destroy();chart=null
  if(!canvas.value||!props.history||props.loading||props.error)return
  const history=props.history
  const values=valueChartPoints(displayedSeries.value)
  const events=history.events.map(e=>({...e,x:dateNumber(e.date),y:0.035}))
  const dates=[...values,...events].map(p=>p.x)
  const bounds=history.range ? {min:Date.parse(history.range.start_date+'T00:00:00Z'),max:Date.parse(history.range.end_date+'T23:59:59.999Z')} : dates.length ? {min:Math.min(...dates)-86400000,max:Math.max(...dates)+86400000} : {}
  const datasets=[{label:includeFunding.value?'Portfolio value':'Overall gains',data:values,yAxisID:'value',borderColor:'#73c6a1',backgroundColor:'#73c6a118',borderWidth:2,fill:true,tension:0.1,spanGaps:false,pointRadius:values.filter(p=>p.y!=null).length===1?5:2,pointHoverRadius:6}]
  for(const type of ['deposit','withdrawal','transfer'])datasets.push({type:'scatter',label:type,data:events.filter(e=>e.type===type),yAxisID:'funding',pointStyle:type==='transfer'?'rectRot':'triangle',pointRotation:type==='withdrawal'?180:0,pointRadius:5,pointHoverRadius:7,backgroundColor:type==='deposit'?'#73c6a1':type==='withdrawal'?'#e97482':'#96acc4'})
  chart=new Chart(canvas.value,{type:'line',data:{datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:false},tooltip:{displayColors:false,backgroundColor:'#111827',titleColor:'#fff',bodyColor:'#e5e7eb',callbacks:{title:items=>dateLabel(new Date(items[0].raw.x).toISOString().slice(0,10)),label:context=>{
    const point=context.raw
    if(point.type)return `${point.account}: ${point.type} ${point.amount==null?nativeMoney(point):signedMoney(point.amount)}`
    return [...(includeFunding.value?[`Combined portfolio: ${money(point.y)}`]:[`Overall gains: ${money(point.y)}`,`Portfolio value: ${money(point.portfolioValue)}`,`Net funding since baseline: ${signedMoney(point.netFunding)}`,...(point.missingFunding?['Funding amounts unavailable']:[])]),`Holdings: ${money(point.holdings)}`,`Cash: ${money(point.cash)}`,`Stablecoins: ${money(point.stablecoins)}`,...(point.estimatedAccounts?['Estimate: missing historical prices valued at zero']:[]),...(point.migrationEstimatedAccounts?['Estimate: documented 1:1 token migration price']:[]),...(point.statementEstimatedAccounts?['Estimate: IBKR weekend holdings at last reported close']:[]),...(point.carryForwardBalances||[]).map(balance=>`Estimate: ${balance.account}; last known value ${dateLabel(balance.from)}`),...(point.igCarryForwardAccounts?['Estimate: last available IG balance; no open positions confirmed']:[]),...(point.reconstructedAccounts?['Rebuilt from historical records and closing prices']:['Recorded snapshot or statement']),...(point.stalePrices?['Includes older market quotes']:[])]
  }}}},scales:{x:{type:'linear',...bounds,grid:{display:false},ticks:{color:'#8290a1',maxTicksLimit:7,callback:value=>new Date(value).toLocaleDateString('en-GB',{...(dates.length&&Math.max(...dates)-Math.min(...dates)<=90*86400000?{day:'numeric',month:'short'}:{month:'short',year:'2-digit'}),timeZone:'UTC'})}},value:{axis:'y',type:'linear',display:history.coverage.recordedDays>0,grid:{color:'#71809618'},ticks:{color:'#8290a1',callback:value=>money(value)}},funding:{axis:'y',type:'linear',display:false,min:0,max:1}}}})
}
watch(()=>[props.history,props.loading,props.error,props.currency,includeFunding.value,hideAmounts.value],render,{immediate:true})
onBeforeUnmount(()=>chart?.destroy())
</script>

<style scoped>
.portfolio-history{padding:20px;margin:24px 0}.history-heading{display:flex;justify-content:space-between;gap:24px;align-items:center}.history-eyebrow{font-size:10px;letter-spacing:.14em;color:#8290a1;font-weight:700}.history-heading h2{margin:0 0 4px}.history-heading p:not(.history-eyebrow),.history-change small{font-size:12px;@apply text-gray-600 dark:text-gray-400}.history-change{@apply text-gray-900 dark:text-white; text-align:right;font-size:13px}.history-change strong{font-size:24px;font-weight:600;display:block}.history-change small{display:block;margin-top:5px}.funding-toggle{@apply text-sm text-gray-700 dark:text-gray-300;display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:10px;cursor:pointer}.history-legend{display:flex;flex-wrap:wrap;gap:20px;font-size:12px;@apply text-gray-500 dark:text-gray-400;margin:24px 0 16px;align-items:center}.value-key{display:inline-block;width:20px;height:2px;background:#73c6a1;vertical-align:middle;margin-right:5px}.deposit-key{color:#73c6a1}.withdrawal-key{color:#e97482}.history-canvas{height:280px;position:relative}.history-message{@apply text-gray-600 dark:text-gray-400; font-size:13px;margin:16px 0;line-height:1.6}@media(max-width:700px){.portfolio-history{padding:16px}.history-heading{align-items:flex-start;flex-direction:column}.history-change{text-align:left}.funding-toggle{justify-content:flex-start}.history-canvas{height:240px}}
</style>
