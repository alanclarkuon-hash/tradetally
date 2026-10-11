<template>
 <BaseModal :model-value="modelValue" :title="'Plan trade · '+asset" size="5xl" @update:model-value="$emit('update:modelValue',$event)">
  <div class="plan-trade-view">
   <header class="view-heading"><p>{{ definition.title }} · {{ definition.direction === 'short' ? 'Short' : 'Long' }}<br><span>Linked fills grouped by your plan rows</span></p><CurrencyToggle :model-value="currency" :currencies="currencyChoices" @update:model-value="$emit('update:currency',$event)" /></header>
   <div class="trade-summary">
    <div><small>Units entered</small><strong>{{ number(linkedQuantity('entry')) }}</strong></div>
    <div><small>Units exited</small><strong>{{ number(linkedQuantity('exit')) }}</strong></div>
    <div><small>Open units</small><strong>{{ number(ledger.openQuantity) }}</strong></div>
    <div><small>Remaining position size</small><strong>{{ ledgerMoney('positionValue',currency) }}</strong></div>
    <div><small>AVG open price</small><strong>{{ ledgerMoney('averagePrice',currency) }}</strong></div>
    <div><small>Total realised profit</small><strong>{{ ledgerMoney('realisedProfit',currency) }}</strong></div>
    <div><small>Realised % gain/loss</small><strong>{{ percent(ledgerMetric('percentGain',currency)) }}</strong></div>
    <div><small>Realised R</small><strong>{{ number(ledgerMetric('realisedR',currency)) }}</strong></div>
   </div>
   <p v-if="ledger.unresolved" class="evidence-warning" role="status">Changed source fills need reconciliation. Affected row amounts are unavailable.</p>
   <p v-if="ledger.provisionalCount" class="evidence-warning" role="status">{{ ledger.provisionalCount }} provisional executions are included in position totals. Link their broker fills to verify the result.</p>
   <p v-if="ledger.overExit" class="evidence-warning" role="status">Linked exits exceed the available entries or precede them. Check the trade links.</p>
   <section v-for="action in ['entry','exit']" :key="action" class="trade-section">
    <h4>{{ action === 'entry' ? 'Entries' : 'Exits' }}</h4>
    <p v-if="!groups(action).length" class="empty-state">No {{ action === 'entry' ? 'entries' : 'exits' }} linked.</p>
    <div v-else class="trade-table-scroll"><table>
     <thead><tr><th>Plan row</th><th>Date</th><th>{{ action === 'entry' ? 'Units bought' : 'Units sold' }}</th><th>AVG price ({{ currency }})</th><th>{{ action === 'entry' ? 'Position size' : 'Realised profit' }} ({{ currency }})</th><th>Source fills</th></tr></thead>
     <tbody><template v-for="group in groups(action)" :key="group.key">
      <tr class="group-row"><td>{{ group.label }}</td><td>{{ dateRange(group) }}</td><td>{{ number(group.quantity) }}</td><td>{{ amount(groupPrice(group,currency,fillRate)) }}</td><td>{{ amount(groupAmount(group,action,currency,rate)) }}</td><td><button class="btn-secondary" :aria-expanded="!!expanded[action+group.key]" @click="expanded[action+group.key]=!expanded[action+group.key]">{{ expanded[action+group.key] ? 'Hide' : 'Show' }} {{ group.fills.length }} {{ group.fills.length === 1 ? 'fill' : 'fills' }}</button></td></tr>
      <tr v-if="expanded[action+group.key]"><td colspan="6" class="source-cell"><div v-for="record in group.fills" :key="record.id" class="source-fill"><span>{{ date(record.fill.time) }}</span><span>{{ number(record.quantity) }} @ {{ money(record.fill.price,record.fill.currency) }}</span><span>{{ record.fill.transactionFx?.rate > 0 ? 'Broker FX '+record.fill.transactionFx.rate+' · '+record.fill.transactionFx.accountCurrency : 'Broker FX unavailable' }}</span><span v-if="!record.valid" class="evidence-warning">Needs reconciliation</span><RouterLink :to="'/trades/'+record.trade_id" class="text-primary-500">Open source trade</RouterLink></div></td></tr>
     </template></tbody>
     <tfoot><tr><th>Total linked</th><td></td><td>{{ number(linkedQuantity(action)) }}</td><td></td><td>{{ amount(totalAmount(action)) }}</td><td>{{ groups(action).reduce((sum,g)=>sum+g.fills.length,0) }} fills</td></tr></tfoot>
    </table></div>
   </section>
  </div>
 </BaseModal>
</template>
<script setup>
import {computed,ref} from 'vue'
import BaseModal from '@/components/common/BaseModal.vue'
import CurrencyToggle from '@/components/common/CurrencyToggle.vue'
import {planTradeGroups,groupPrice,groupAmount} from './planTradeGroups'
const props=defineProps({modelValue:Boolean,definition:{type:Object,required:true},ledger:{type:Object,required:true},asset:String,currency:String,currencyChoices:Array,fillRate:Function,rate:Function,ledgerMoney:Function,ledgerMetric:Function})
defineEmits(['update:modelValue','update:currency'])
const expanded=ref({})
const grouped=computed(()=>Object.fromEntries(['entry','exit'].map(action=>[action,planTradeGroups(props.definition,props.ledger.records,action)])))
const groups=action=>grouped.value[action]
const linkedQuantity=action=>groups(action).reduce((sum,g)=>sum+g.quantity,0)
const number=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toLocaleString(undefined,{maximumFractionDigits:6})
const percent=value=>value==null?'Unavailable':number(value)+'%'
const money=(value,currency)=>new Intl.NumberFormat(undefined,{style:'currency',currency}).format(value)
const amount=value=>value==null?'Unavailable':money(value,props.currency)
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Date unavailable'
const dateRange=group=>group.fills[0].fill.time===group.fills.at(-1).fill.time?date(group.fills[0].fill.time):date(group.fills[0].fill.time)+' → '+date(group.fills.at(-1).fill.time)
function totalAmount(action){const values=groups(action).map(g=>groupAmount(g,action,props.currency,props.rate));return !values.length||values.some(v=>v==null)?null:values.reduce((sum,v)=>sum+v,0)}
</script>
<style scoped>
.plan-trade-view{color:inherit;font-variant-numeric:tabular-nums}.view-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}.view-heading p{font-weight:600}.view-heading span{font-weight:400;color:#6b7280;font-size:13px}.trade-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px 16px;padding:20px;background:rgb(127 127 127 / .08);border:1px solid rgb(127 127 127 / .2);border-radius:8px}.trade-summary small{display:block;color:#6b7280;font-size:12px;margin-bottom:6px}.trade-summary strong{font-size:20px;overflow-wrap:anywhere}.trade-section{margin-top:28px}.trade-section h4{font-size:18px;font-weight:600;margin-bottom:12px}.trade-table-scroll{overflow-x:auto}table{width:100%;min-width:720px}th,td{text-align:left;padding:14px 10px;border-bottom:1px solid rgb(127 127 127 / .25);vertical-align:top}th{font-size:12px;color:#6b7280}td{font-size:14px}th:nth-child(3),th:nth-child(4),th:nth-child(5),td:nth-child(3),td:nth-child(4),td:nth-child(5){text-align:right}.source-cell{background:rgb(127 127 127 / .06)}.source-fill{display:flex;flex-wrap:wrap;gap:12px 20px;padding:10px 0;font-size:13px}.source-fill+.source-fill{border-top:1px solid rgb(127 127 127 / .2)}.evidence-warning{color:#b45309;font-size:14px;margin-top:12px}.empty-state{color:#6b7280;font-size:14px}.btn-secondary{min-height:42px;white-space:nowrap}tfoot{border-top:2px solid rgb(127 127 127 / .3)}tfoot th{font-size:14px}:global(.dark) .view-heading span,:global(.dark) .trade-summary small,:global(.dark) th,:global(.dark) .empty-state{color:#9ca3af}:global(.dark) .evidence-warning{color:#fcd34d}@media(max-width:700px){.trade-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.trade-summary strong{font-size:18px}}
</style>
