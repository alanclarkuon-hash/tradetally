import {mount,flushPromises} from '@vue/test-utils'
import {it,expect,vi} from 'vitest'
vi.mock('vue-router',()=>({useRouter:()=>({push:vi.fn()})}))
vi.mock('@/stores/uiPreferences',()=>({useUiPreferencesStore:()=>({notifyChanged:vi.fn()})}))
vi.mock('@/stores/accounts',()=>({useAccountsStore:()=>({fetchAccounts:async()=>[
  {accountIdentifier:'one',accountName:'First'},{accountIdentifier:'two',accountName:'Second'}]})}))
vi.mock('@/services/api',()=>({default:{get:async()=>({data:{accounts:['one','two']}})}}))
import GlobalAccountSelector from './GlobalAccountSelector.vue'
import {useGlobalAccountFilter} from '@/composables/useGlobalAccountFilter'
it('keeps the menu open for multiple ticks, supports All/empty, and closes outside or on Escape',async()=>{
 const filter=useGlobalAccountFilter();filter.setAccounts([])
 const view=mount(GlobalAccountSelector,{attachTo:document.body});await flushPromises()
 await view.find('button').trigger('click')
 let boxes=view.findAll('[role="menuitemcheckbox"]')
 await boxes[2].trigger('click');await boxes[1].trigger('click')
 expect(filter.selectedAccounts.value).toEqual(['__unsorted__','one'])
 expect(boxes[1].attributes('aria-checked')).toBe('true')
 expect(boxes[2].attributes('aria-checked')).toBe('true')
 expect(boxes[3].attributes('aria-checked')).toBe('false')
 expect(view.find('[role="menu"]').exists()).toBe(true)
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await flushPromises()
 expect(view.find('[role="menu"]').exists()).toBe(false)
 await view.find('button').trigger('click');boxes=view.findAll('[role="menuitemcheckbox"]')
 await boxes[0].trigger('click')
 expect(boxes.every(box=>box.attributes('aria-checked')==='true')).toBe(true)
 await boxes[0].trigger('click')
 expect(filter.selectedAccounts.value).toEqual([])
 expect(boxes.every(box=>box.attributes('aria-checked')==='false')).toBe(true)
 expect(view.text()).toContain('No accounts selected')
 document.body.click();await flushPromises()
 expect(view.find('[role="menu"]').exists()).toBe(false)
 view.unmount();filter.clearAccount()
})
