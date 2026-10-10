import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,ref} from 'vue'
import {createPinia,setActivePinia} from 'pinia'
import {useAuthStore} from '@/stores/auth'
import {beforeEach,describe,it,expect,vi} from 'vitest'
import CurrencyCard from './CurrencyCard.vue'
import CurrencyToggle from './CurrencyToggle.vue'
const mock=vi.hoisted(()=>({get:vi.fn(),accounts:null,selection:null,hidden:null}))
vi.mock('@/services/api',()=>({default:{get:mock.get}}))
vi.mock('@/composables/useGlobalAccountFilter',async()=>{const {ref}=await import('vue');mock.accounts=ref([]);mock.selection=ref(null);return {useGlobalAccountFilter:()=>({accounts:mock.accounts,selectedAccount:mock.selection,fetchAccounts:vi.fn()})}})
vi.mock('@/composables/useDashboardPrivacy',async()=>{const {ref}=await import('vue');mock.hidden=ref(false);return {MONEY_MASK:'hidden',useMonetaryPrivacy:()=>({hideAmounts:mock.hidden})}})
beforeEach(()=>{localStorage.clear();setActivePinia(createPinia());useAuthStore().user={settings:{display_currency:'GBP'}};mock.hidden.value=false;mock.selection.value=null;mock.accounts.value=[{value:'gbp',currency:'GBP'},{value:'usd',currency:'USD'},{value:'eur',currency:'EUR'}];mock.get.mockResolvedValue({data:{rates:{USD:1,GBP:.8,EUR:.9}}})})
const host=defineComponent({components:{CurrencyCard},template:`<div><CurrencyCard source-currency="GBP" v-slot="{formatCurrency}"><p>{{formatCurrency(80)}}</p></CurrencyCard><CurrencyCard source-currency="USD" v-slot="{formatSignedCurrency}"><p>{{formatSignedCurrency(100)}}</p></CurrencyCard></div>`})
describe('independent card currency controls',()=>{
 it('cycles GBP, USD, EUR, GBP and converts each card independently',async()=>{const w=mount(host);await flushPromises();const buttons=w.findAll('button');expect(w.findAll('p').map(p=>p.text())).toEqual(['£80.00','+£80.00']);await buttons[0].trigger('click');expect(buttons[0].text()).toBe('$');expect(w.findAll('p').map(p=>p.text())).toEqual(['$100.00','+£80.00']);await buttons[0].trigger('click');expect(w.findAll('p')[0].text()).toBe('€90.00');await buttons[0].trigger('click');expect(w.findAll('p')[0].text()).toBe('£80.00');w.unmount()})
 it('removes currencies outside account scope and follows display settings',async()=>{const w=mount(host);await flushPromises();await w.find('button').trigger('click');mock.selection.value='eur';await flushPromises();expect(w.find('button').text()).toBe('£');await w.find('button').trigger('click');expect(w.find('button').text()).toBe('€');useAuthStore().user.settings.display_currency='USD';await flushPromises();expect(w.find('button').text()).toBe('$');expect(w.find('button').attributes('aria-label')).toContain('switch to EUR');w.unmount()})
 it('never exposes hidden amounts or labels missing conversion as a valid number',async()=>{const w=mount(host);await flushPromises();mock.hidden.value=true;await flushPromises();await w.find('button').trigger('click');expect(w.findAll('p').map(p=>p.text())).toEqual(['hidden','hidden']);w.unmount()})
 it('retains keyboard accessibility, shows current symbol and labels the next currency',async()=>{const w=mount(CurrencyToggle,{props:{modelValue:'GBP',currencies:['GBP','USD','EUR']}});expect(w.text()).toBe('£');expect(w.attributes('aria-label')).toBe('Showing GBP; switch to USD');await w.trigger('click');expect(w.emitted('update:modelValue')[0]).toEqual(['USD']);w.unmount()})
})

it('remembers independent cards on remount and resets absent cards after settings changes',async()=>{
 const props={preferenceKey:'remembered',sourceCurrency:'GBP'};
 let w=mount(CurrencyCard,{props});await flushPromises();await w.find('button').trigger('click');w.unmount();
 w=mount(CurrencyCard,{props});await flushPromises();expect(w.find('button').text()).toBe('$');w.unmount();
 const {observeCardCurrencyDefault}=await import('@/composables/useCardCurrencyPreference');
 const auth=useAuthStore();const observer=defineComponent({setup(){observeCardCurrencyDefault(auth)},template:'<div />'});
 const root=mount(observer);auth.user.settings.display_currency='EUR';await flushPromises();auth.user.settings.display_currency='GBP';await flushPromises();
 w=mount(CurrencyCard,{props});await flushPromises();expect(w.find('button').text()).toBe('£');w.unmount();root.unmount();
});
it('keeps different card identities and signed-in users separate',async()=>{
 const auth=useAuthStore();auth.user.id='one';
 const first=mount(CurrencyCard,{props:{preferenceKey:'first'}});const second=mount(CurrencyCard,{props:{preferenceKey:'second'}});await flushPromises();
 await first.find('button').trigger('click');expect(second.find('button').text()).toBe('£');
 auth.user={id:'two',settings:{display_currency:'GBP'}};await flushPromises();expect(first.find('button').text()).toBe('£');
 auth.user={id:'one',settings:{display_currency:'GBP'}};await flushPromises();expect(first.find('button').text()).toBe('$');first.unmount();second.unmount();
});
