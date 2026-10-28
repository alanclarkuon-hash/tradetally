<template>
  <article class="@container card-dense relative overflow-hidden" aria-label="Portfolio value summary">
    <div class="absolute inset-0 opacity-[0.04] dark:opacity-[0.08] pointer-events-none" aria-hidden="true">
      <div class="w-full h-full" style="background-image: linear-gradient(rgba(120,120,120,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(120,120,120,0.6) 1px, transparent 1px); background-size: 24px 24px;" />
    </div>
    <div class="relative card-dense-body">
      <div class="flex flex-col @3xl:flex-row gap-4 @3xl:gap-6 @3xl:items-stretch">
        <div class="@3xl:flex-[2] min-w-0 flex flex-col">
          <div class="flex items-baseline justify-between mb-1 gap-2">
            <h2 class="text-label">{{ incomplete ? 'Known portfolio value' : 'Combined portfolio value' }}</h2>
            <CurrencyToggle v-model="cardCurrency" :currencies="choices" />
          </div>
          <div class="mt-auto pt-1">
            <div class="text-mono-num font-semibold tracking-tight leading-none text-gray-900 dark:text-white" :class="totalSizeClass">{{ totalDisplay }}</div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400 text-mono-num">Latest · {{ accountCount }} accounts · {{ cardCurrency }}</p>
          </div>
        </div>
        <dl class="grid grid-cols-1 @sm:grid-cols-2 gap-3 @sm:gap-4 @3xl:flex-[3] @3xl:gap-6 @3xl:border-l @3xl:border-gray-200 @3xl:dark:border-gray-700 @3xl:pl-4 @4xl:pl-6">
          <div class="flex flex-col min-w-0">
            <dt class="text-label mb-1">Holdings value</dt>
            <dd class="mt-auto pt-1">
              <div class="text-mono-num text-lg @sm:text-xl @3xl:text-2xl @4xl:text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">{{ formatCurrency(totals.holdingsValue) }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Invested holdings</div>
            </dd>
          </div>
          <div class="flex flex-col min-w-0 @3xl:border-l @3xl:border-gray-200 @3xl:dark:border-gray-700 @3xl:pl-4 @4xl:pl-6">
            <dt class="text-label mb-1">Cash &amp; stablecoins</dt>
            <dd class="mt-auto pt-1">
              <div class="text-mono-num text-lg @sm:text-xl @3xl:text-2xl @4xl:text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">{{ formatCurrency(totals.cashValue+totals.stablecoinValue) }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 text-mono-num mt-0.5">Cash {{ formatCurrency(totals.cashValue) }} · Stablecoins {{ formatCurrency(totals.stablecoinValue) }}</div>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed, toRef } from 'vue'
import CurrencyToggle from '@/components/common/CurrencyToggle.vue'
import { useCardCurrency } from '@/composables/useCardCurrency'

const props=defineProps({
  totals:{type:Object,required:true},
  accountCount:{type:Number,required:true},
  sourceCurrency:{type:String,required:true},
  incomplete:Boolean
})
const {currency:cardCurrency,choices,formatCurrency}=useCardCurrency(toRef(props,'sourceCurrency'),undefined,'portfoliodashboardview-1')
const totalDisplay=computed(()=>formatCurrency(props.totals.portfolioValue))
// Follow the Trading hero ribbon's length-aware sizing so the full total fits.
const totalSizeClass=computed(()=>{
  const length=totalDisplay.value.length
  if(length>=12)return 'text-xl @sm:text-2xl @3xl:text-3xl @4xl:text-4xl'
  if(length>=10)return 'text-2xl @sm:text-3xl @3xl:text-3xl @4xl:text-4xl'
  if(length>=8)return 'text-2xl @sm:text-3xl @3xl:text-4xl'
  return 'text-3xl @sm:text-4xl @3xl:text-4xl @4xl:text-5xl'
})
</script>
