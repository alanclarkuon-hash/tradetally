import { shallowMount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  store: null
}))

vi.mock('@/stores/brokerSync', () => ({
  useBrokerSyncStore: () => mocks.store
}))

import BrokerReconnectBanner from '@/components/broker-sync/BrokerReconnectBanner.vue'

describe('BrokerReconnectBanner', () => {
  beforeEach(() => {
    mocks.store = reactive({
      connections: [],
      fetchConnections: vi.fn(),
      initSchwabOAuth: vi.fn()
    })
  })

  it('stays visible with a direct reconnect action while Schwab is expired', async () => {
    mocks.store.connections = [{
      id: 'connection-1',
      brokerType: 'schwab',
      connectionStatus: 'expired'
    }]

    const wrapper = shallowMount(BrokerReconnectBanner, {
      global: {
        stubs: {
          RouterLink: { template: '<a><slot /></a>' }
        }
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Broker reconnect required')
    expect(wrapper.text()).toContain('New trades will not sync')
    expect(wrapper.get('button').text()).toBe('Reconnect Schwab')
    expect(mocks.store.fetchConnections).toHaveBeenCalledTimes(1)
  })

  it('does not render when every broker connection is active', async () => {
    mocks.store.connections = [{
      id: 'connection-1',
      brokerType: 'schwab',
      connectionStatus: 'active'
    }]

    const wrapper = shallowMount(BrokerReconnectBanner)
    await flushPromises()

    expect(wrapper.text()).toBe('')
  })

  it('prompts for reauthorization before the Schwab deadline', async () => {
    mocks.store.connections = [{
      id: 'connection-1',
      brokerType: 'schwab',
      connectionStatus: 'active',
      schwab_refresh_token_expires_at: new Date(Date.now() + (12 * 60 * 60 * 1000)).toISOString()
    }]

    const wrapper = shallowMount(BrokerReconnectBanner)
    await flushPromises()

    expect(wrapper.text()).toContain('Schwab authorization expires soon')
    expect(wrapper.text()).toContain('keep automatic trade syncing uninterrupted')
    expect(wrapper.get('button').text()).toBe('Reauthorize Schwab')
  })
})


describe('Broker sync failure notices',()=>{
  it('shows failed reconciliation after login and clears only after successful sync',async()=>{
    mocks.store=reactive({connections:[{id:'okx-main',brokerType:'okx',accountLabel:'Main account',connectionStatus:'error',lastSyncStatus:'failed',lastErrorMessage:'Holdings do not match reconstructed lots'}],fetchConnections:vi.fn(),initSchwabOAuth:vi.fn()})
    const wrapper=shallowMount(BrokerReconnectBanner,{global:{stubs:{RouterLink:{name:'RouterLink',props:['to'],template:'<a :href="to"><slot /></a>'}}}})
    await flushPromises()
    expect(mocks.store.fetchConnections).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="alert"]').text()).toContain('Broker sync failed')
    expect(wrapper.text()).toContain('OKX · Main account')
    expect(wrapper.text()).toContain('Holdings do not match reconstructed lots')
    expect(wrapper.findComponent({name:'RouterLink'}).props('to')).toBe('/broker-sync')
    mocks.store.connections[0].connectionStatus='active'
    await flushPromises()
    expect(wrapper.text()).toContain('Broker sync failed')
    mocks.store.connections[0].lastSyncStatus='success'
    await flushPromises()
    expect(wrapper.text()).toBe('')
    wrapper.unmount()
  })
  it('lists multiple broker failures without offering an unrelated Schwab reconnect',async()=>{
    mocks.store=reactive({connections:[{id:'a',brokerType:'okx',connectionStatus:'error'},{id:'b',brokerType:'trading212',connectionStatus:'active',lastSyncStatus:'failed',lastSyncMessage:'Incomplete broker history'}],fetchConnections:vi.fn(),initSchwabOAuth:vi.fn()})
    const wrapper=shallowMount(BrokerReconnectBanner);await flushPromises()
    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(wrapper.text()).toContain('Trading 212')
    expect(wrapper.text()).toContain('Incomplete broker history')
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
})
