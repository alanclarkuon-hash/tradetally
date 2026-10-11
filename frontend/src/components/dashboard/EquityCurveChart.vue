<template>
  <div class="equity-curve">
    <div class="flex justify-end mb-2"><CurrencyToggle v-model="cardCurrency" :currencies="choices" /></div>
    <p v-if="fxMissing" class="text-sm text-amber-700 dark:text-amber-300">FX unavailable for the selected currency.</p>
    <div class="relative h-[280px]"><canvas ref="canvas" /></div>
  </div>
</template>

<script setup>
import CurrencyToggle from '@/components/common/CurrencyToggle.vue'
import {useCardCurrency} from '@/composables/useCardCurrency'
// Command-center equity curve for the dashboard's equity-and-calendar section.
// Owns its full Chart.js lifecycle (create/update/destroy) so the parent view
// doesn't have to manage a canvas ref or a createCharts()/setTimeout flow.
// Data comes in via props; day clicks are emitted up for navigation.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Chart } from '@/lib/chartSetup'
import { formatTradeDate } from '@/utils/date'
import { useMonetaryPrivacy, MONEY_MASK } from '@/composables/useDashboardPrivacy'
const { hideAmounts } = useMonetaryPrivacy()

const props = defineProps({
  dailyPnL: {
    type: Array,
    default: () => []
  },
  sourceCurrency: { type: String, default: undefined }
})

const {currency:cardCurrency,choices,formatCurrency,convert,rates}=useCardCurrency(computed(()=>props.sourceCurrency),undefined,'equitycurvechart-1')
const pnlValues = computed(() => props.dailyPnL.map(d => convert(d.cumulative_pnl)))
const fxMissing = computed(() => pnlValues.value.some(v => v == null))
const formatAxis = value => formatCurrency(value, {currency:cardCurrency.value})
const emit = defineEmits(['select-date'])

const canvas = ref(null)
let chartInstance = null

function renderChart() {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
  if (!canvas.value) return

  const ctx = canvas.value.getContext('2d')
  const dailyData = props.dailyPnL || []
  if (dailyData.length === 0) return

  if (fxMissing.value) return
  const positiveColor = 'rgba(22, 163, 74, 1)'
  const negativeColor = 'rgba(220, 38, 38, 1)'
  const positiveFill = 'rgba(22, 163, 74, 0.12)'
  const negativeFill = 'rgba(220, 38, 38, 0.12)'

  try {
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dailyData.map(d => formatTradeDate(d.trade_date, 'MMM dd')),
        datasets: [{
          label: 'Cumulative P&L',
          data: pnlValues.value,
          fill: {
            target: 'origin',
            above: positiveFill,
            below: negativeFill
          },
          segment: {
            borderColor: c => (c.p1.parsed.y >= 0 ? positiveColor : negativeColor)
          },
          borderWidth: 2,
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: '#F0812A',
          pointHoverBorderColor: '#F0812A'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        onClick: (_event, elements) => {
          if (elements.length > 0) {
            emit('select-date', dailyData[elements[0].index].trade_date)
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            titleColor: '#fff',
            bodyColor: '#e5e7eb',
            padding: 8,
            displayColors: false,
            callbacks: {
              label: ctx => hideAmounts.value ? MONEY_MASK : formatAxis(Number(ctx.parsed.y))
            }
          }
        },
        scales: {
          y: {
            beginAtZero: false,
            grid: { color: 'rgba(156, 163, 175, 0.08)' },
            ticks: {
              font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 },
              callback: v => hideAmounts.value ? MONEY_MASK : formatAxis(Number(v))
            }
          },
          x: {
            grid: { display: false },
            ticks: {
              font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 },
              maxRotation: 0,
              autoSkipPadding: 24
            }
          }
        }
      }
    })
  } catch (error) {
    console.error('[DASHBOARD] equity curve chart create failed:', error)
  }
}

onMounted(renderChart)
watch(() => [props.dailyPnL, props.sourceCurrency,cardCurrency.value,rates.value, hideAmounts.value], renderChart)
onBeforeUnmount(() => {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
})
</script>
