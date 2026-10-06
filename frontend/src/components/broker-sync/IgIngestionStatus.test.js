import {mount,flushPromises} from '@vue/test-utils'
import {vi,it,expect,afterEach} from 'vitest'
import api from '@/services/api'
import IgIngestionStatus from './IgIngestionStatus.vue'
vi.mock('@/services/api',()=>({default:{get:vi.fn()}}))
afterEach(()=>vi.clearAllMocks())
it('shows failed and successful results with no financial amounts',async()=>{
 api.get.mockResolvedValue({data:{data:{enabled:true,running:false,source:{pending:1},documents:[{id:'one',account_name:'Synthetic account',statement_date:'2026-10-05',status:'conflict',reason:'Different values require review.'}]}}})
 const w=mount(IgIngestionStatus);await flushPromises();expect(w.text()).toContain('Automatic ingestion enabled');expect(w.text()).toContain('Conflicting statement');expect(w.text()).toContain('2026-10-05');w.unmount()
})
it('reports a status endpoint failure without a raw server error',async()=>{
 api.get.mockRejectedValue(new Error('private details'));const w=mount(IgIngestionStatus);await flushPromises();expect(w.text()).toContain('Unable to load IG statement status');expect(w.text()).not.toContain('private details');w.unmount()
})
