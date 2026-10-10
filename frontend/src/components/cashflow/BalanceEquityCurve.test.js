import {mount,flushPromises} from '@vue/test-utils'
import {createPinia,setActivePinia} from 'pinia'
import {useAuthStore} from '@/stores/auth'
import {beforeEach,it,expect,vi} from 'vitest'
import BalanceEquityCurve from './BalanceEquityCurve.vue'
const mock=vi.hoisted(()=>({history:vi.fn(),charts:[]}))
vi.mock('@/lib/chartSetup',()=>({Chart:class {constructor(canvas,config){mock.charts.push(config)}destroy(){}}}))
vi.mock('@/stores/plaidFunding',()=>({usePlaidFundingStore:()=>({fetchBalanceHistory:mock.history})}))
vi.mock('@/services/api',()=>({default:{get:vi.fn().mockResolvedValue({data:{rates:{GBP:.8,EUR:.9}}})}}))
vi.mock('@/composables/useGlobalAccountFilter',async()=>{const {ref}=await import('vue');return {useGlobalAccountFilter:()=>({accounts:ref([{value:'account',currency:'USD'}]),selectedAccount:ref(null),fetchAccounts:vi.fn()})}})
beforeEach(()=>{setActivePinia(createPinia());useAuthStore().user={settings:{display_currency:'GBP'}};mock.history.mockResolvedValue({currency:'USD',series:[{date:'2026-01-01',currentBalance:100},{date:'2026-01-02',currentBalance:300}],accounts:[{accountName:'Synthetic'}],coverage:{sourceCurrencies:['GBP','USD','EUR'],missingFx:0}})})
it('converts known USD reporting balances and cycles all represented currencies',async()=>{const w=mount(BalanceEquityCurve);await flushPromises();const chart=()=>mock.charts.at(-1);expect(chart().options.scales.y.ticks.callback(300)).toBe('£240.00');const control=w.find('.currency-toggle');await control.trigger('click');await flushPromises();expect(control.text()).toBe('$');expect(chart().options.scales.y.ticks.callback(300)).toBe('$300.00');await control.trigger('click');await flushPromises();expect(chart().options.scales.y.ticks.callback(300)).toBe('€270.00');w.unmount()})
it('shows missing evidence instead of converting an unknown balance to zero',async()=>{mock.history.mockResolvedValue({currency:'USD',series:[{date:'2026-01-01',currentBalance:null},{date:'2026-01-02',currentBalance:100}],accounts:[{accountName:'Synthetic'}],coverage:{sourceCurrencies:['USD'],missingFx:1}});const w=mount(BalanceEquityCurve);await flushPromises();expect(w.text()).toContain('Some balances lack currency or exchange-rate evidence');expect(mock.charts.at(-1).data.datasets[0].data).toEqual([null,100]);w.unmount()})
