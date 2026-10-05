import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const api=vi.hoisted(()=>({get:vi.fn()}))
vi.mock('@/services/api',()=>({default:api}))
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();localStorage.clear();api.get.mockReset()})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})

it('paints cached metadata and picks up hydrated logos with a bounded background poll',async()=>{
 api.get.mockResolvedValueOnce({data:{metadata:{COLD:{symbol:'COLD',companyName:'Cached name',metadataPending:true}}}})
   .mockResolvedValue({data:{metadata:{COLD:{symbol:'COLD',companyName:'Hydrated name',logo:'https://example.com/logo.png'}}}})
 const {useSymbolMetadata}=await import('./useSymbolMetadata')
 const {metadataBySymbol}=useSymbolMetadata('COLD','stock')
 await vi.advanceTimersByTimeAsync(15)
 expect(metadataBySymbol['stock:COLD'].companyName).toBe('Cached name')
 await vi.advanceTimersByTimeAsync(3020)
 expect(metadataBySymbol['stock:COLD'].logo).toContain('logo.png')
 await vi.advanceTimersByTimeAsync(60000)
 expect(api.get).toHaveBeenCalledTimes(2)
})

it('stops polling unresolved metadata and does not persist pending results',async()=>{
 api.get.mockResolvedValue({data:{metadata:{COLD:{symbol:'COLD',metadataPending:true}}}})
 const {useSymbolMetadata}=await import('./useSymbolMetadata')
 useSymbolMetadata('COLD','crypto')
 await vi.advanceTimersByTimeAsync(70000)
 expect(api.get).toHaveBeenCalledTimes(21)
 expect(localStorage.getItem('tt_symbol_metadata_v2')).not.toContain('COLD')
 await vi.advanceTimersByTimeAsync(70000)
 expect(api.get).toHaveBeenCalledTimes(21)
})
