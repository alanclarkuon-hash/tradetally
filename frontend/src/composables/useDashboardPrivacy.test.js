import { defineComponent, nextTick, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useDashboardPrivacy, useMonetaryPrivacy, MONEY_MASK, DASHBOARD_PRIVACY } from './useDashboardPrivacy'
import MoneyPrivacyToggle from '@/components/dashboard/MoneyPrivacyToggle.vue'
import PortfolioValueChart from '@/components/dashboard/PortfolioValueChart.vue'
import { useCurrencyFormatter } from './useCurrencyFormatter'
vi.mock('@/stores/auth',()=>({useAuthStore:()=>({user:{settings:{display_currency:'GBP'}}})}))
const charts=vi.hoisted(()=>[])
vi.mock('@/lib/chartSetup',()=>({Chart:class {constructor(_canvas,config){charts.push(config)}destroy(){}}}))

describe('dashboard monetary privacy',()=>{
  it('shares the toggle, masks signed amounts and narrative text, and persists without hiding percentages',async()=>{
    const Child=defineComponent({setup(){return {...useCurrencyFormatter(),...useMonetaryPrivacy()}},template:'<p>{{formatSignedCurrency(1234)}} · 12.5% NVDA · {{maskMoneyText("Profit +£123.45 and USD 55.00; 25% win rate")}}</p>'})
    const Root=defineComponent({components:{Child,MoneyPrivacyToggle},setup(){const privacy=useDashboardPrivacy();privacy.hideAmounts.value=false;return privacy},template:'<MoneyPrivacyToggle/><Child/>'})
    const view=mount(Root)
    expect(view.text()).toContain('1,234')
    await view.get('button').trigger('click')
    expect(view.get('button').attributes('aria-pressed')).toBe('true')
    expect(view.get('button').attributes('aria-label')).toBe('Show monetary values')
    expect(view.text()).not.toContain('123')
    expect(view.text()).not.toContain('55.00')
    expect(view.text()).toContain('12.5% NVDA')
    expect(localStorage.getItem('dashboardHideMoney')).toBe('true')
    await view.get('button').trigger('click')
    expect(view.text()).toContain('1,234')
    view.unmount()
  })
  it('does not mask currency on screens outside the dashboard context',()=>{
    const view=mount(defineComponent({setup:()=>useCurrencyFormatter(),template:'<p>{{formatCurrency(125)}}</p>'}))
    expect(view.text()).toContain('125.00')
    view.unmount()
  })
  it('masks chart axis and all tooltip amounts when toggled without changing the underlying series',async()=>{
    const hidden=ref(false)
    const history={change:100,series:[{date:'2026-01-01',value:500,holdings:300,cash:180,stablecoins:20}],events:[],coverage:{recordedDays:1}}
    const view=mount(PortfolioValueChart,{props:{history},global:{provide:{[DASHBOARD_PRIVACY]:hidden}}})
    await flushPromises()
    expect(charts.at(-1).options.scales.value.ticks.callback(500)).toContain('500')
    hidden.value=true;await nextTick();await flushPromises()
    const config=charts.at(-1)
    expect(config.options.scales.value.ticks.callback(500)).toBe(MONEY_MASK)
    const labels=config.options.plugins.tooltip.callbacks.label({raw:config.data.datasets[0].data[0]})
    expect(labels.join(' ')).not.toMatch(/500|300|180/)
    expect(config.data.datasets[0].data[0].y).toBe(500)
    expect(view.text()).not.toContain('100.00')
    view.unmount()
  })
})
