import {mount,flushPromises} from '@vue/test-utils'
import {beforeEach,expect,it,vi} from 'vitest'
vi.mock('@/services/api',()=>({default:{get:vi.fn(),post:vi.fn()}}))
import api from '@/services/api'
import IgFileImport from './IgFileImport.vue'
const account={id:'synthetic',name:'Synthetic share account',kind:'share_dealing',required:['transactions','trading','ledger']}
beforeEach(()=>{vi.clearAllMocks();api.get.mockResolvedValue({data:{data:[account]}});api.post.mockImplementation(async url=>({data:{data:url.endsWith('/preview')?
  {token:'preview-token',accounts:[{name:account.name,cash:25,closedTrades:0,holdings:0}],importedTrades:0,importedEvents:0,transfers:0,notice:'Balances match'}:
  {importedTrades:0,importedEvents:0}}}))})
async function ready(){const w=mount(IgFileImport);await flushPromises();await w.get('input[type=checkbox]').setValue(true);
  for(const input of w.findAll('input[type=file][required]')){Object.defineProperty(input.element,'files',{configurable:true,value:[new File(['synthetic'],'synthetic.csv')]});await input.trigger('change')}
  return w}
it('requires a successful preview before apply and sends only its server token',async()=>{
  const w=await ready();expect(w.get('fieldset').element.disabled).toBe(false);expect(w.text()).not.toContain('Import checked reports');await w.get('form').trigger('submit');
  await flushPromises();expect(w.get('fieldset').element.disabled).toBe(false);
  expect(w.text()).toContain('Balance checks passed');expect(api.post).toHaveBeenCalledWith('/broker-sync/ig-files/preview',expect.any(FormData),expect.any(Object));
  await w.findAll('button').find(b=>b.text()==='Import checked reports').trigger('click');await flushPromises();
  expect(api.post).toHaveBeenLastCalledWith('/broker-sync/ig-files/apply',{token:'preview-token'},expect.any(Object));expect(w.text()).toContain('Import finished');
})
it('disables account controls only while a preview is running',async()=>{
  const w=await ready();let finish;api.post.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  await w.get('form').trigger('submit');expect(w.get('fieldset').element.disabled).toBe(true);
  finish({data:{data:{token:'preview-token',accounts:[],notice:'Checked'}}});await flushPromises();
  expect(w.get('fieldset').element.disabled).toBe(false);
})
it('changing a file invalidates the preview and removes the apply action',async()=>{
  const w=await ready();await w.get('form').trigger('submit');await flushPromises();expect(w.text()).toContain('Import checked reports');
  await w.get('input[type=file]').trigger('change');expect(w.text()).not.toContain('Import checked reports');
})
it('shows reconciliation errors without offering an import action',async()=>{
  const w=await ready();api.post.mockRejectedValueOnce({response:{data:{message:'Upload the matching transfer account report.'}}});await w.get('form').trigger('submit');await flushPromises();
  expect(w.get('[role=alert]').text()).toContain('matching transfer');expect(w.text()).not.toContain('Import checked reports');
})
it('sends multiple optional trade-day statements for the selected account',async()=>{
  const w=await ready(),input=w.get('input[type=file][multiple]');
  Object.defineProperty(input.element,'files',{configurable:true,value:[new File(['first'],'first.pdf'),new File(['second'],'second.pdf')]});
  await input.trigger('change');await w.get('form').trigger('submit');await flushPromises();
  const form=api.post.mock.calls[0][1];expect(form.getAll('synthetic:execution')).toHaveLength(2);
});
it('allows daily spread-bet PDFs alone and sends them as history evidence',async()=>{
  api.get.mockResolvedValue({data:{data:[{...account,kind:'spread_bet',required:['transactions','activity','breakdown','trading','ledger']}]}});
  const w=mount(IgFileImport);await flushPromises();await w.get('input[type=checkbox]').setValue(true);
  const input=w.get('input[multiple]');
  Object.defineProperty(input.element,'files',{configurable:true,value:[new File(['day1'],'day1.pdf'),new File(['day2'],'day2.pdf')]});
  await input.trigger('change');expect(w.findAll('input[required]')).toHaveLength(0);
  await w.get('form').trigger('submit');await flushPromises();
  const form=api.post.mock.calls[0][1];expect(form.getAll('synthetic:daily')).toHaveLength(2);
  expect(form.has('synthetic:transactions')).toBe(false);
});
