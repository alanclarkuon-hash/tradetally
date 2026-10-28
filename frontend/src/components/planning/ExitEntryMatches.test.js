import {mount,flushPromises} from '@vue/test-utils'
import {describe,it,expect,vi,beforeEach} from 'vitest'
import ExitEntryMatches from './ExitEntryMatches.vue'
const {put}=vi.hoisted(()=>({put:vi.fn()}));vi.mock('@/services/api',()=>({default:{put}}))
const props=()=>({plan:{id:'synthetic',version:4},editable:true,entries:[{key:'low',label:'Lower grid'},{key:'high',label:'Upper grid'}],exits:[{key:'sale',label:'Target'}],matching:[{exitKey:'sale',quantity:2,status:'needs_match',matches:[],options:[{entryKey:'low',quantity:4},{entryKey:'high',quantity:2}]}]})
beforeEach(()=>{put.mockReset();put.mockResolvedValue({data:{success:true}})})
describe('exit row matches',()=>{
 it('requires an exact total and submits selected entry rows with plan version',async()=>{const w=mount(ExitEntryMatches,{props:props()});expect(w.text()).toContain('Match entry rows');await w.get('button').trigger('click');const save=()=>w.findAll('button').find(b=>b.text()==='Save entry matches');expect(save().attributes('disabled')).toBeDefined();await w.get('input[aria-label="Units from Lower grid"]').setValue(2);expect(save().attributes('disabled')).toBeUndefined();await save().trigger('click');await flushPromises();expect(put).toHaveBeenCalledWith('/trade-plans/synthetic/exit-matches',{version:4,exitKey:'sale',matches:[{entryKey:'low',quantity:2}]});expect(w.emitted('saved')).toHaveLength(1);w.unmount()});
 it('opens existing selections for editing and cancelling does not write',async()=>{const p=props();p.matching[0].status='matched';p.matching[0].matches=[{entryKey:'high',quantity:2}];const w=mount(ExitEntryMatches,{props:p});expect(w.text()).toContain('Upper grid');await w.get('button').trigger('click');expect(w.get('input[aria-label="Units from Upper grid"]').element.value).toBe('2');await w.get('button').trigger('click');expect(put).not.toHaveBeenCalled();w.unmount()});
 it('keeps rejected matches visible and never emits saved',async()=>{put.mockRejectedValue({response:{data:{error:'Plan changed elsewhere'}}});const w=mount(ExitEntryMatches,{props:props()});await w.get('button').trigger('click');await w.get('input[aria-label="Units from Lower grid"]').setValue(2);await w.findAll('button').find(b=>b.text()==='Save entry matches').trigger('click');await flushPromises();expect(w.get('[role="alert"]').text()).toBe('Plan changed elsewhere');expect(w.emitted('saved')).toBeUndefined();w.unmount()});
 it('read-only plans show matches without edit controls',()=>{const w=mount(ExitEntryMatches,{props:{...props(),editable:false}});expect(w.find('button').exists()).toBe(false);w.unmount()});
})

it('permits the same precision boundary for total coverage and entry availability',async()=>{
 const p=props();p.matching[0].quantity=17.00000002;p.matching[0].options=[{entryKey:'low',quantity:17.00000001}];
 const w=mount(ExitEntryMatches,{props:p});await w.get('button').trigger('click');await w.get('input').setValue(17.00000001);
 const save=()=>w.findAll('button').find(b=>b.text()==='Save entry matches');expect(save().attributes('disabled')).toBeUndefined();
 await save().trigger('click');await flushPromises();expect(put).toHaveBeenCalledWith('/trade-plans/synthetic/exit-matches',{version:4,exitKey:'sale',matches:[{entryKey:'low',quantity:17.00000001}]});w.unmount();
});
it('blocks a genuine over-allocation instead of rounding it away',async()=>{
 const p=props();p.matching[0].quantity=17.00000004;p.matching[0].options=[{entryKey:'low',quantity:17.00000001}];
 const w=mount(ExitEntryMatches,{props:p});await w.get('button').trigger('click');await w.get('input').setValue(17.00000004);
 expect(w.findAll('button').find(b=>b.text()==='Save entry matches').attributes('disabled')).toBeDefined();expect(put).not.toHaveBeenCalled();w.unmount();
});


it('shows remaining availability separately and disables entries fully assigned to other exits',async()=>{
 const p=props();p.matching[0].options=[{entryKey:'low',quantity:0,totalQuantity:4,assignedQuantity:4},{entryKey:'high',quantity:1,totalQuantity:3,assignedQuantity:2}];p.matching[0].quantity=1;
 const w=mount(ExitEntryMatches,{props:p});await w.get('button').trigger('click');
 expect(w.get('input[aria-label="Units from Lower grid"]').attributes('disabled')).toBeDefined();
 expect(w.text()).toContain('0 available units');expect(w.text()).toContain('4 assigned to other exits');
 await w.get('input[aria-label="Units from Upper grid"]').setValue(1);
 expect(w.findAll('button').find(b=>b.text()==='Save entry matches').attributes('disabled')).toBeUndefined();w.unmount();
});

it('retains this exit own saved quantities while editing net availability',async()=>{
 const p=props();p.matching[0]={exitKey:'sale',quantity:2,status:'matched',matches:[{entryKey:'low',quantity:2}],options:[{entryKey:'low',quantity:2,totalQuantity:5,assignedQuantity:3}]};
 const w=mount(ExitEntryMatches,{props:p});await w.get('button').trigger('click');
 expect(w.get('input').element.value).toBe('2');expect(w.text()).toContain('2 available units');
 expect(w.findAll('button').find(b=>b.text()==='Save entry matches').attributes('disabled')).toBeUndefined();w.unmount();
});


it('formats floating-point subtraction at broker precision without changing matching quantities',async()=>{
 const p=props();p.matching[0].options=[{entryKey:'low',quantity:1.0999999999999996,totalQuantity:5.3,assignedQuantity:4.2}];
 const w=mount(ExitEntryMatches,{props:p});await w.get('button').trigger('click');
 expect(w.text()).toContain('1.1 available units');expect(w.text()).not.toContain('1.0999999999999996');w.unmount();
});
