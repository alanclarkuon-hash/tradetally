import {mount,flushPromises} from '@vue/test-utils'
import {describe,it,expect,vi,beforeEach} from 'vitest'
import ExitMatching from './ExitMatching.vue'
import api from '@/services/api'
vi.mock('@/services/api',()=>({default:{get:vi.fn(),post:vi.fn()}}))
vi.mock('@/composables/useCurrencyFormatter',()=>({useCurrencyFormatter:()=>({formatCurrency:v=>'£'+v})}))
const state={supported:true,version:'v1',exits:[{index:1,quantity:2,price:110,datetime:'2026-01-03T12:00:00Z'}],available:[{id:'exit',originTradeId:'source',execution:{quantity:2,price:110,datetime:'2026-01-03T12:00:00Z'}}],history:[]}
beforeEach(()=>{vi.clearAllMocks();api.get.mockResolvedValue({data:state});api.post.mockResolvedValue({data:{}})})
const factory=()=>mount(ExitMatching,{props:{trade:{id:'trade',symbol:'TEST',original_currency:'GBP'}},global:{stubs:{RouterLink:true}}})
describe('exit correction',()=>{
 it('detaches without requiring a reason and refreshes after success',async()=>{const w=factory();await flushPromises();expect(w.find('input').exists()).toBe(false);await w.findAll('button')[0].trigger('click');await flushPromises();expect(api.post).toHaveBeenCalledWith('/trades/trade/exit-matching',{operation:'detach',index:1,version:'v1'});expect(w.emitted('changed')).toHaveLength(1)})
 it('links preserved exit and displays server validation failures',async()=>{const w=factory();await flushPromises();api.post.mockRejectedValue({response:{data:{error:'Exit exceeds the shares held'}}});await w.findAll('button')[1].trigger('click');await flushPromises();expect(api.post).toHaveBeenCalledWith('/trades/trade/exit-matching',expect.objectContaining({operation:'attach',exitId:'exit'}));expect(w.get('[role=alert]').text()).toContain('exceeds');expect(w.emitted('changed')).toBeUndefined()})
 it('does not expose controls for unsupported execution formats',async()=>{api.get.mockResolvedValue({data:{supported:false}});const w=factory();await flushPromises();expect(w.find('button').exists()).toBe(false)})
})
