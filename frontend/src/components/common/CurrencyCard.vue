<template>
  <div class="currency-card">
    <CurrencyToggle v-model="currency" :currencies="choices" class="currency-card-control" />
    <slot :format-currency="formatCurrency" :format-signed-currency="formatSignedCurrency" :format-trade-currency="formatTradeCurrency" :format-trade-signed-currency="formatTradeSignedCurrency" :currency="currency" :convert="convert" />
  </div>
</template>
<script setup>
import { toRef } from 'vue'
import CurrencyToggle from './CurrencyToggle.vue'
import { useCardCurrency } from '@/composables/useCardCurrency'
const props = defineProps({ sourceCurrency: String, accountCurrencies: Array, tradeRows: Boolean })
const {currency,choices,convert,formatCurrency,formatSignedCurrency}=useCardCurrency(toRef(props,'sourceCurrency'),toRef(props,'accountCurrencies'))
function tradeOptions(trade, options) { return props.tradeRows ? {...options, currency: trade?.effective_currency || trade?.display_currency || props.sourceCurrency} : trade || {} }
const formatTradeCurrency=(value,trade,options)=>formatCurrency(value,tradeOptions(trade,options))
const formatTradeSignedCurrency=(value,trade,options)=>formatSignedCurrency(value,tradeOptions(trade,options))
</script>
<style scoped>
.currency-card{position:relative;min-width:0}
.currency-card-control{float:right;position:relative;z-index:2;margin:12px 16px 4px 12px}
.currency-card:after{content:'';display:block;clear:both}
</style>
