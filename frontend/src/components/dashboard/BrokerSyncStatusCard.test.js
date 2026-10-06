import {mount,flushPromises} from '@vue/test-utils'
import {describe,it,expect,vi} from 'vitest'
const get=vi.hoisted(()=>vi.fn())
vi.mock('@/services/api',()=>({default:{get}}))
vi.mock('@/composables/useUserTimezone',()=>({useUserTimezone:()=>({timezoneLabel:'GMT',formatDateTime:v=>v})}))
import Card from './BrokerSyncStatusCard.vue'
describe('broker sync status card',()=>{
  it('shows all connections, successes and failures independently of chart coverage',async()=>{
    get.mockResolvedValue({data:{data:[{id:1,broker:'kraken',status:'failed',lastSuccessfulSyncAt:'2026-10-01',lastFailureAt:'2026-10-02',failure:'Permissions need review'},{id:2,broker:'trading212',status:'success'},{id:3,broker:'ig',status:'manual'}]}})
    const view=mount(Card,{global:{stubs:{RouterLink:true}}});await flushPromises()
    expect(view.text()).toContain('Kraken');expect(view.text()).toContain('Trading 212');expect(view.text()).toContain('IG');
    expect(view.text()).toContain('2026-10-01');expect(view.text()).toContain('Permissions need review');expect(view.text()).toContain('no API sync');
    view.unmount()
  })
  it('retains the existing statuses when refreshing fails',async()=>{
    get.mockResolvedValueOnce({data:{data:[{id:1,broker:'okx',status:'success'}]}}).mockRejectedValueOnce(new Error('offline'))
    const view=mount(Card,{global:{stubs:{RouterLink:true}}});await flushPromises()
    await view.find('button').trigger('click');await flushPromises();expect(view.text()).toContain('OKX');expect(view.find('[role="alert"]').exists()).toBe(true);view.unmount()
  })
})
