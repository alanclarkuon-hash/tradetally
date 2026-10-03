<template>
  <section class="portfolio-history" aria-labelledby="portfolio-history-title">
    <div class="history-heading">
      <div><p class="history-eyebrow">THE BIGGER PICTURE</p><h2 id="portfolio-history-title">Portfolio value over time</h2><p>Investments, cash and stablecoins · selected accounts</p></div>
      <div class="history-change"><strong v-if="history?.change!=null">{{ signedMoney(history.change) }}</strong><span v-else>Recording portfolio values</span><small>Change includes money added and removed</small></div>
    </div>
    <p v-if="loading" class="history-message" role="status">Loading portfolio history…</p>
    <p v-else-if="error" class="history-message" role="status">{{ error }}</p>
    <template v-else-if="history">
      <div class="history-legend"><span><i class="value-key"></i>Recorded portfolio value</span><span class="deposit-key">▲ Deposit</span><span class="withdrawal-key">▼ Withdrawal</span><span>◆ Transfer across selection</span></div>
      <div class="history-canvas"><canvas ref="canvas" role="img" aria-label="Recorded portfolio values and funding activity over time. Details are available below." /></div>
      <p class="history-message" v-if="history.coverage.recordedDays<2">{{ history.coverage.recordedDays===1 ? `Value recording started on ${dateLabel(history.coverage.firstValueDate)}. The growth line will build as more days are recorded.` : 'No recorded portfolio values in this date range.' }} Earlier funding activity is shown along the bottom; earlier portfolio values are unavailable.</p>
      <p class="history-message" v-else>Values recorded from {{ dateLabel(history.coverage.firstValueDate) }}. Breaks in the line mean a daily value is unavailable.</p>
      <p class="history-footnote">Deposits and withdrawals are already reflected in the recorded balances; they are not added a second time. Matched transfers between selected accounts are excluded from funding markers. Coin transfers are not included in these cash funding markers. Quotes may be older than the recording date.</p>
      <p v-if="history.coverage.partialDays||history.coverage.missingEventFx" class="history-message">{{ history.coverage.partialDays }} days lack complete selected-account values. {{ history.coverage.missingEventFx }} funding amounts are shown in their original currency because dated exchange rates are unavailable.</p>
      <details class="history-details"><summary>Recorded values and funding activity</summary>
        <div class="history-table"><table><caption>Portfolio values</caption><thead><tr><th>Date</th><th>Value</th><th>Holdings</th><th>Cash</th><th>Stablecoins</th></tr></thead><tbody><tr v-for="point in history.series" :key="point.date"><td>{{ dateLabel(point.date) }}</td><td>{{ money(point.value) }}</td><td>{{ money(point.holdings) }}</td><td>{{ money(point.cash) }}</td><td>{{ money(point.stablecoins) }}</td></tr><tr v-if="!history.series.length"><td colspan="5">No recorded values for this range.</td></tr></tbody></table></div>
        <div class="history-table"><table><caption>Cash funding activity</caption><thead><tr><th>Date</th><th>Account</th><th>Movement</th><th>Amount</th></tr></thead><tbody><tr v-for="(event,i) in history.events" :key="i"><td>{{ dateLabel(event.date) }}</td><td>{{ event.account }}</td><td>{{ event.type }}</td><td>{{ event.amount==null ? nativeMoney(event) : signedMoney(event.amount) }}</td></tr><tr v-if="!history.events.length"><td colspan="4">No recorded cash funding movements for this range.</td></tr></tbody></table></div>
      </details>
    </template>
  </section>
</template>

<script setup>
import {ref,watch,onBeforeUnmount,nextTick} from 'vue'
import {Chart} from '@/lib/chartSetup'
import {dateNumber,valueChartPoints} from '@/utils/portfolioValueChart'
const props=defineProps({history:Object,loading:Boolean,error:String,currency:{type:String,default:'GBP'}})
const canvas=ref(null)
let chart=null
const money=value=>value==null?'Unavailable':new Intl.NumberFormat('en-GB',{style:'currency',currency:props.currency,maximumFractionDigits:2}).format(value)
const signedMoney=value=>(value>=0?'+':'−')+money(Math.abs(value))
const nativeMoney=event=>new Intl.NumberFormat('en-GB',{style:'currency',currency:event.nativeCurrency}).format(event.nativeAmount)
const dateLabel=date=>date?new Date(dateNumber(date)).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'Unavailable'
async function render() {
  await nextTick()
  chart?.destroy();chart=null
  if(!canvas.value||!props.history||props.loading||props.error)return
  const history=props.history
  const values=valueChartPoints(history.series)
  const events=history.events.map(e=>({...e,x:dateNumber(e.date),y:0.035}))
  const dates=[...values,...events].map(p=>p.x)
  const datasets=[{label:'Portfolio value',data:values,yAxisID:'value',borderColor:'#73c6a1',backgroundColor:'#73c6a118',borderWidth:2,fill:true,tension:0.1,spanGaps:false,pointRadius:values.filter(p=>p.y!=null).length===1?5:2,pointHoverRadius:6}]
  for(const type of ['deposit','withdrawal','transfer'])datasets.push({type:'scatter',label:type,data:events.filter(e=>e.type===type),yAxisID:'funding',pointStyle:type==='transfer'?'rectRot':'triangle',pointRotation:type==='withdrawal'?180:0,pointRadius:5,pointHoverRadius:7,backgroundColor:type==='deposit'?'#73c6a1':type==='withdrawal'?'#e97482':'#96acc4'})
  chart=new Chart(canvas.value,{type:'line',data:{datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:false},tooltip:{displayColors:false,backgroundColor:'#111827',titleColor:'#fff',bodyColor:'#e5e7eb',callbacks:{title:items=>dateLabel(new Date(items[0].raw.x).toISOString().slice(0,10)),label:context=>{
    const point=context.raw
    if(point.type)return `${point.account}: ${point.type} ${point.amount==null?nativeMoney(point):signedMoney(point.amount)}`
    return [`Portfolio value: ${money(point.y)}`,`Holdings: ${money(point.holdings)}`,`Cash: ${money(point.cash)}`,`Stablecoins: ${money(point.stablecoins)}`,...(point.stalePrices?['Includes older market quotes']:[])]
  }}}},scales:{x:{type:'linear',...(dates.length?{min:Math.min(...dates)-86400000,max:Math.max(...dates)+86400000}:{}),grid:{display:false},ticks:{color:'#8290a1',maxTicksLimit:7,callback:value=>new Date(value).toLocaleDateString('en-GB',{...(dates.length&&Math.max(...dates)-Math.min(...dates)<=90*86400000?{day:'numeric',month:'short'}:{month:'short',year:'2-digit'}),timeZone:'UTC'})}},value:{axis:'y',type:'linear',display:history.coverage.recordedDays>0,grid:{color:'#71809618'},ticks:{color:'#8290a1',callback:value=>money(value)}},funding:{axis:'y',type:'linear',display:false,min:0,max:1}}}})
}
watch(()=>[props.history,props.loading,props.error,props.currency],render,{immediate:true})
onBeforeUnmount(()=>chart?.destroy())
</script>

<style scoped>
.portfolio-history{border:1px solid #71809633;border-radius:9px;padding:24px;margin:26px 0;background:#71809605}.history-heading{display:flex;justify-content:space-between;gap:24px;align-items:center}.history-eyebrow{font-size:10px;letter-spacing:.14em;color:#8290a1;font-weight:700}.history-heading h2{font-size:19px;font-weight:600;margin:5px 0}.history-heading p:not(.history-eyebrow),.history-change small{font-size:12px;color:#8290a1}.history-change{text-align:right;font-size:13px}.history-change strong{font-size:24px;font-weight:600;display:block}.history-change small{display:block;margin-top:5px}.history-legend{display:flex;flex-wrap:wrap;gap:20px;font-size:11px;color:#8290a1;margin:24px 0 16px;align-items:center}.value-key{display:inline-block;width:20px;height:2px;background:#73c6a1;vertical-align:middle;margin-right:5px}.deposit-key{color:#73c6a1}.withdrawal-key{color:#e97482}.history-canvas{height:280px;position:relative}.history-message{font-size:12px;color:#b4c1cf;margin:16px 0;line-height:1.6}.history-footnote{font-size:11px;color:#8290a1;line-height:1.6;margin-top:12px}.history-details{font-size:12px;margin-top:14px;color:#8290a1}.history-details summary{cursor:pointer;padding:8px 0}.history-table{overflow-x:auto;margin-top:14px;max-height:280px}table{width:100%;text-align:left;border-collapse:collapse;font-size:11px}caption{text-align:left;font-weight:600;margin-bottom:10px}td,th{padding:8px;border-bottom:1px solid #71809622;white-space:nowrap}@media(max-width:700px){.portfolio-history{padding:16px}.history-heading{align-items:flex-start;flex-direction:column}.history-change{text-align:left}.history-canvas{height:240px}}
</style>
