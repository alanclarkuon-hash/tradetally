import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import HeroMetricsRibbon from './HeroMetricsRibbon.vue'
import EquityCurveChart from './EquityCurveChart.vue'
import CurrencyCard from '@/components/common/CurrencyCard.vue'
const mock=vi.hoisted(()=>({get:vi.fn(),accounts:null,selection:null,hidden:null,charts:[],destroy:vi.fn()}))
vi.mock('@/router',()=>({default:{push:vi.fn()}}))
vi.mock('@/components/common/MiniBarChart.vue',()=>({default:{name:'MiniBarChart',props:['values','labels','height','fill'],template:'<div />'}}))
vi.mock('@/services/api',()=>({default:{get:mock.get}}))
vi.mock('@/composables/useGlobalAccountFilter',async()=>{const {ref}=await import('vue');mock.accounts=ref([]);mock.selection=ref(null);return {useGlobalAccountFilter:()=>({accounts:mock.accounts,selectedAccount:mock.selection,fetchAccounts:vi.fn()})}})
vi.mock('@/composables/useDashboardPrivacy',async()=>{const {ref}=await import('vue');mock.hidden=ref(false);return {MONEY_MASK:'hidden',useMonetaryPrivacy:()=>({hideAmounts:mock.hidden})}})
vi.mock('@/lib/chartSetup',()=>({Chart:class{constructor(ctx,config){mock.charts.push(config)}destroy(){mock.destroy()}}}))
beforeEach(()=>{localStorage.clear();setActivePinia(createPinia());useAuthStore().user={id:'synthetic-user',settings:{display_currency:'GBP'}};mock.accounts.value=[{value:'gbp',currency:'GBP'},{value:'usd',currency:'USD'},{value:'eur',currency:'EUR'}];mock.selection.value=null;mock.hidden.value=false;mock.get.mockResolvedValue({data:{rates:{USD:1,GBP:.8,EUR:.9}}});mock.charts.length=0;mock.destroy.mockClear();HTMLCanvasElement.prototype.getContext=vi.fn(()=>({}))})
const analytics={display_currency:'GBP',summary:{totalNetPnL:80,totalRValue:2,totalTrades:2,totalCosts:8},dailyPnL:[{trade_date:'2026-01-02',daily_pnl:30,r_value:.75},{trade_date:'2026-01-03',daily_pnl:50,r_value:1.25}]}
describe('Net P/L currency and R control',()=>{
 it('cycles GBP, USD, EUR, R and back with R restricted to this card',async()=>{
  const w=mount(HeroMetricsRibbon,{props:{analytics},global:{stubs:{MiniBarChart:true}}});const other=mount(CurrencyCard);await flushPromises();const button=w.find('button');expect(w.findAll('button')).toHaveLength(1);expect(w.text()).toContain('+£80.00');
  await button.trigger('click');expect(button.text()).toBe('$');expect(w.text()).toContain('+$100.00');expect(w.findComponent({name:'MiniBarChart'}).props('values')).toEqual([37.5,62.5]);
  await button.trigger('click');expect(button.text()).toBe('€');expect(w.text()).toContain('+€90.00');await button.trigger('click');expect(button.text()).toBe('R');expect(w.text()).toContain('+2.00R');expect(w.findComponent({name:'MiniBarChart'}).props('values')).toEqual([.75,1.25]);expect(other.find('button').attributes('aria-label')).not.toContain('R');await button.trigger('click');expect(button.text()).toBe('£');w.unmount();other.unmount();
 });
 it('offers R even with only one account currency, remembers selection, then follows changed app display currency',async()=>{
  mock.selection.value='gbp';let w=mount(HeroMetricsRibbon,{props:{analytics},global:{stubs:{MiniBarChart:true}}});await flushPromises();expect(w.find('button').attributes('disabled')).toBeUndefined();await w.find('button').trigger('click');expect(w.find('button').text()).toBe('R');w.unmount();w=mount(HeroMetricsRibbon,{props:{analytics},global:{stubs:{MiniBarChart:true}}});await flushPromises();expect(w.find('button').text()).toBe('R');useAuthStore().user.settings.display_currency='EUR';await flushPromises();expect(w.find('button').text()).toBe('€');w.unmount();
 });
})
describe('cumulative chart currency and lifecycle',()=>{
 it('converts actual plotted points and labels exactly once and preserves date navigation',async()=>{
  const days=[{trade_date:'2026-01-02',cumulative_pnl:30},{trade_date:'2026-01-03',cumulative_pnl:80}];const w=mount(EquityCurveChart,{props:{dailyPnL:days,sourceCurrency:'GBP'}});await flushPromises();expect(mock.charts.at(-1).data.datasets[0].data).toEqual([30,80]);await w.find('button').trigger('click');const config=mock.charts.at(-1);expect(config.data.datasets[0].data).toEqual([37.5,100]);expect(config.options.plugins.tooltip.callbacks.label({parsed:{y:100}})).toBe('$100.00');expect(config.options.scales.y.ticks.callback(100)).toBe('$100.00');config.options.onClick({},[{index:1}]);expect(w.emitted('select-date')[0]).toEqual(['2026-01-03']);await w.find('button').trigger('click');expect(mock.charts.at(-1).data.datasets[0].data).toEqual([33.75,90]);mock.hidden.value=true;await flushPromises();expect(mock.charts.at(-1).options.scales.y.ticks.callback(90)).toBe('hidden');w.unmount();expect(mock.destroy).toHaveBeenCalled();
 });
 it('shows missing conversion without silently plotting zeroes',async()=>{
  const w=mount(EquityCurveChart,{props:{dailyPnL:[{trade_date:'2026-01-02',cumulative_pnl:10}],sourceCurrency:'ZZZ'}});await flushPromises();expect(w.text()).toContain('FX unavailable');expect(mock.charts).toHaveLength(0);w.unmount();
 });
})
