import {mount} from '@vue/test-utils'
import {describe,expect,it} from 'vitest'
import IgConnectionModal from './IgConnectionModal.vue'
describe('IG connection',()=>{
  it('masks credentials, preserves password spaces and defaults to September 2025 history',async()=>{
    const wrapper=mount(IgConnectionModal)
    for(const id of ['#ig-key','#ig-username','#ig-password'])expect(wrapper.get(id).attributes('type')).toBe('password')
    await wrapper.get('#ig-key').setValue(' synthetic-key ')
    await wrapper.get('#ig-username').setValue(' synthetic-user ')
    await wrapper.get('#ig-password').setValue(' synthetic-password ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')[0][0]).toMatchObject({api_key:'synthetic-key',username:'synthetic-user',password:' synthetic-password ',sync_start_date:'2025-09-01'})
    expect(wrapper.text()).not.toContain('synthetic-password')
  })
  it('does not submit twice while checking credentials, but always allows closing',async()=>{
    const wrapper=mount(IgConnectionModal,{props:{loading:true,error:'Check your IG login'}})
    await wrapper.get('#ig-key').setValue('synthetic-key');await wrapper.get('#ig-username').setValue('synthetic-user');await wrapper.get('#ig-password').setValue('synthetic-password')
    await wrapper.get('form').trigger('submit');expect(wrapper.emitted('save')).toBeUndefined()
    await wrapper.get('[aria-label="Close IG connection"]').trigger('click');expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.get('[role="alert"]').text()).toBe('Check your IG login')
  })
})
