import {describe,it,expect} from 'vitest'
import {sectorEnrichmentMessage} from './sectorEnrichmentStatus'
describe('sector enrichment status',()=>{
  it('only claims processing while the scheduler is processing',()=>{
    expect(sectorEnrichmentMessage({running:true,processing:true})).toContain('Processing symbols')
    expect(sectorEnrichmentMessage({running:true,processing:false})).toContain('awaiting scheduled')
    expect(sectorEnrichmentMessage({running:false,processing:false})).toContain('is off')
    expect(sectorEnrichmentMessage(null)).not.toContain('Processing symbols')
  })
})
