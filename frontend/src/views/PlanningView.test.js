import {mount,flushPromises} from '@vue/test-utils'
import {describe,it,expect,vi,beforeEach} from 'vitest'
import {ref} from 'vue'
import PlanningView from './PlanningView.vue'
const {get,post,put,selectedAccount}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),put:vi.fn(),selectedAccount:{value:null}}))
vi.mock('@/services/api',()=>({default:{get,post,put}}))
vi.mock('@/stores/accounts',()=>({useAccountsStore:()=>({accounts:[],fetchAccounts:vi.fn().mockResolvedValue([])})}))
vi.mock('@/composables/useGlobalAccountFilter',()=>({useGlobalAccountFilter:()=>({selectedAccount,selectedAccountLabel:ref('All accounts')})}))
vi.mock('vue-router',()=>({useRouter:()=>({replace:vi.fn().mockResolvedValue()}),useRoute:()=>({params:{}})}))
const factory=()=>mount(PlanningView,{global:{stubs:{RouterLink:{template:'<a><slot/></a>'},MoneyPrivacyToggle:true}}})
beforeEach(()=>{vi.clearAllMocks();get.mockImplementation(url=>Promise.resolve({data:url==='/trade-plans'?{plans:[],commitments:[]}:{playbooks:[]}}))})
describe('Planning first slice',()=>{
 it('never claims the missing portfolio capacity is verified',async()=>{const w=factory();await flushPromises();expect(w.text()).toContain('not verified');expect(w.text()).toContain('No committed entries');expect(w.text()).toContain('Ready reserves no capacity');w.unmount()})
 it('new plan offers stop-distance toggle and separate position/risk fields',async()=>{const w=factory();await flushPromises();await w.findAll('button').find(b=>b.text()==='New plan').trigger('click');expect(w.text()).toContain('Initial plan risk budget');expect(w.text()).toContain('Full planned position size');const toggle=w.findAll('button').find(b=>b.text().includes('SL distance:'));await toggle.trigger('click');expect(toggle.text()).toContain('GBP');expect(post).not.toHaveBeenCalled();w.unmount()})
})