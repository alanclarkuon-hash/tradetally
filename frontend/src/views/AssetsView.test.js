import {mount,flushPromises} from '@vue/test-utils'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import AssetsView from './AssetsView.vue'
const mock=vi.hoisted(()=>({get:vi.fn(),replace:vi.fn()}))
vi.mock('@/services/api',()=>({default:mock}))
vi.mock('vue-router',()=>({useRoute:()=>({query:{symbol:'EXAMPLE.L'}}),useRouter:()=>({replace:mock.replace})}))
vi.mock('@/stores/auth',()=>({useAuthStore:()=>({user:{timezone:'Europe/London'}})}))
afterEach(()=>{vi.useRealTimers()})
const asset={symbol:'EXAMPLE.L',name:'Example fund',kind:'Fund / ETF',recordCount:0,labels:[],sections:[]}
beforeEach(()=>{vi.clearAllMocks();mock.replace.mockResolvedValue();})
it('shows close, session, provider, dated currency equivalent and honest save-time label',async()=>{
 mock.get.mockResolvedValue({data:{...asset,previousClose:{status:'available',amount:8,currency:'USD',sessionDate:'2026-10-14',source:'stockanalysis:twelve',savedAt:'2026-10-15T10:00:00Z',nativeEquivalent:{amount:6,currency:'GBP',usdRate:.75,fxDate:'2026-10-14'}}}})
 const view=mount(AssetsView);await flushPromises();const summary=view.get('[aria-labelledby="asset-close-title"]').text();expect(summary).toContain('Previous session close');expect(summary).toContain('14 October 2026');expect(summary).toContain('Stock Analysis / Twelve Data');expect(summary).toContain('GBP equivalent');expect(summary).toContain('6.00');expect(summary).toContain('$8.00');expect(summary).toContain('1 USD = 0.75 GBP');expect(summary).toContain('exact market capture time');expect(summary).toContain('11:00:00 BST');view.unmount()
})
it('makes a missing session explicit instead of displaying an older price',async()=>{
 mock.get.mockResolvedValue({data:{...asset,previousClose:{status:'missing',sessionDate:'2026-10-14'}}});const view=mount(AssetsView);await flushPromises();expect(view.text()).toContain('No verified closing price is saved for 14 October 2026');expect(view.find('.asset-close-price').exists()).toBe(false);expect(mock.get).toHaveBeenCalledTimes(1);view.unmount()
})

it('uses shared name suggestions and opens the selected exchange symbol',async()=>{
 vi.useFakeTimers()
 mock.get.mockImplementation(url=>Promise.resolve(url==='/symbols/search'?{data:{results:[{symbol:'EXAMPLE.L',company_name:'Example fund',source:'user_trades'}]}}:{data:asset}))
 const view=mount(AssetsView);await flushPromises();mock.get.mockClear()
 const input=view.get('#asset-symbol');await input.trigger('focus');await input.setValue('example fund')
 await vi.advanceTimersByTimeAsync(300);await flushPromises()
 expect(mock.get).toHaveBeenCalledWith('/symbols/search',{params:{q:'EXAMPLE FUND'}})
 expect(view.get('[role="option"]').text()).toContain('Example fund')
 await input.trigger('keydown',{key:'ArrowDown'});await input.trigger('keydown',{key:'Enter'})
 expect(input.element.value).toBe('EXAMPLE.L')
 expect(mock.get).not.toHaveBeenCalledWith('/investments/assets/EXAMPLE.L')
 await view.get('form').trigger('submit');await flushPromises()
 expect(mock.get).toHaveBeenCalledWith('/investments/assets/EXAMPLE.L')
 expect(mock.replace).toHaveBeenCalledWith({query:{symbol:'EXAMPLE.L'}});view.unmount()
})
it('keeps manual symbol submission available without selecting a suggestion',async()=>{
 mock.get.mockResolvedValue({data:asset});const view=mount(AssetsView);await flushPromises();mock.get.mockClear()
 await view.get('#asset-symbol').setValue('new.l');await view.get('form').trigger('submit');await flushPromises()
 expect(mock.get).toHaveBeenCalledWith('/investments/assets/NEW.L');view.unmount()
})
