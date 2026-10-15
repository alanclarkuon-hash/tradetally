import {mount,flushPromises} from '@vue/test-utils'
import {beforeEach,it,expect,vi} from 'vitest'
import AssetsView from './AssetsView.vue'
const mock=vi.hoisted(()=>({get:vi.fn(),replace:vi.fn()}))
vi.mock('@/services/api',()=>({default:mock}))
vi.mock('vue-router',()=>({useRoute:()=>({query:{symbol:'EXAMPLE.L'}}),useRouter:()=>({replace:mock.replace})}))
vi.mock('@/stores/auth',()=>({useAuthStore:()=>({user:{timezone:'Europe/London'}})}))
const asset={symbol:'EXAMPLE.L',name:'Example fund',kind:'Fund / ETF',recordCount:0,labels:[],sections:[]}
beforeEach(()=>{vi.clearAllMocks();mock.replace.mockResolvedValue();})
it('shows close, session, provider, dated currency equivalent and honest save-time label',async()=>{
 mock.get.mockResolvedValue({data:{...asset,previousClose:{status:'available',amount:8,currency:'USD',sessionDate:'2026-10-14',source:'stockanalysis:twelve',savedAt:'2026-10-15T10:00:00Z',nativeEquivalent:{amount:6,currency:'GBP',usdRate:.75,fxDate:'2026-10-14'}}}})
 const view=mount(AssetsView);await flushPromises();const summary=view.get('[aria-labelledby="asset-close-title"]').text();expect(summary).toContain('Previous session close');expect(summary).toContain('14 October 2026');expect(summary).toContain('Stock Analysis / Twelve Data');expect(summary).toContain('GBP equivalent');expect(summary).toContain('6.00');expect(summary).toContain('$8.00');expect(summary).toContain('1 USD = 0.75 GBP');expect(summary).toContain('exact market capture time');expect(summary).toContain('11:00:00 BST');view.unmount()
})
it('makes a missing session explicit instead of displaying an older price',async()=>{
 mock.get.mockResolvedValue({data:{...asset,previousClose:{status:'missing',sessionDate:'2026-10-14'}}});const view=mount(AssetsView);await flushPromises();expect(view.text()).toContain('No verified closing price is saved for 14 October 2026');expect(view.find('.asset-close-price').exists()).toBe(false);expect(mock.get).toHaveBeenCalledTimes(1);view.unmount()
})

it('keeps long saved records and section links inside the keyboard-accessible scrolling region',async()=>{
 const records=Array.from({length:25},(_,i)=>({price_date:`2026-10-${String(25-i).padStart(2,'0')}`,close:10+i}));
 mock.get.mockResolvedValue({data:{...asset,recordCount:26,sections:[{key:'historical_prices',title:'Historical prices',count:26,offset:0,records}]}});
 const view=mount(AssetsView);await flushPromises();const pane=view.get('[aria-label="Asset details"]');expect(pane.attributes('tabindex')).toBe('0');expect(pane.findAll('.asset-record')).toHaveLength(25);expect(pane.get('a[href="#asset-historical_prices"]').text()).toContain('Historical prices');expect(pane.get('#asset-historical_prices').text()).toContain('1–25 of 26');view.unmount();
})
