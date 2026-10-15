import {describe,it,expect} from 'vitest'
import {applyQuotes,quoteKeys} from './portfolioQuoteRefresh'
const date=new Date().toISOString(),old=new Date(Date.now()-3600000).toISOString()
const row={symbol:'ABC',instrumentType:'stock',quantity:2,value:10,pnlBasis:8,pnl:2,pnlPercent:25,priceAsOf:old}
const data={currency:'GBP',holdings:[row,{...row,symbol:'CFD',instrumentType:'cfd'}],stablecoins:[],totals:{cashValue:5},coverage:{},heatmapDate:'2026-01-01',heatmapHoldings:[row]}
const payload={currency:'GBP',usdRate:.8,quotes:[{symbol:'ABC',current_price:10,last_updated:date,data_source:'yahoo'},{symbol:'CFD',current_price:100,last_updated:date}],asOf:date}
describe('automatic quote valuation',()=>{
 it('converts once, preserves period basis/cash/dated heatmap and does not treat CFD equity as underlying shares',()=>{
 const result=applyQuotes(data,payload);expect(result.holdings[0]).toMatchObject({value:16,pnl:8,pnlPercent:100});expect(result.holdings[1]).toBe(data.holdings[1]);expect(result.totals.portfolioValue).toBe(31);expect(result.heatmapHoldings).toBe(data.heatmapHoldings)
 });
 it('ignores old replies, wrong currency and unknown period basis',()=>{
 expect(applyQuotes(data,{...payload,currency:'USD'})).toBe(data)
 expect(applyQuotes(data,{...payload,quotes:[{...payload.quotes[0],last_updated:new Date(Date.now()-7200000).toISOString()}]}).holdings[0]).toBe(row)
 expect(applyQuotes({...data,holdings:[{...row,pnlBasis:null}]},payload).holdings[0].pnl).toBeNull()
 });
 it('excludes derivative/composite keys and keeps the existing display-FX basis consistent',()=>{
 expect(quoteKeys([row,{...row,symbol:'OPTION CONTRACT',instrumentType:'option'},{...row,symbol:'HALTED NAME'}])).toEqual(['ABC'])
 expect(applyQuotes({...data,displayUsdRate:0.5},payload).holdings[0]).toMatchObject({value:10,pnl:2})
 })

 it('refreshes broker equity only for the exact account set, quantity and capital; never uses underlying quotes',()=>{
 const cfd={...row,instrumentType:'cfd',valuationKind:'broker_position',accounts:['one'],cost:80,pnlBasis:80,value:90};
 const base={...data,displayUsdRate:0.8,holdings:[cfd]};
 const valuations={positions:[{symbol:'ABC',instrumentType:'cfd',accounts:['one'],quantity:2,capital:100,value:110,asOf:date,source:'broker:etoro:position',status:'current'}]};
 const out=applyQuotes(base,{...payload,valuations});expect(out.holdings[0]).toMatchObject({value:88,pnl:8,priceAsOf:date});expect(out.totals.portfolioValue).toBe(93)
 expect(applyQuotes(base,{...payload,valuations:{positions:[{...valuations.positions[0],accounts:['other']}]}}).holdings[0]).toBe(cfd)
 expect(applyQuotes(base,{...payload,valuations:{positions:[{...valuations.positions[0],quantity:1}]}}).holdings[0]).toMatchObject({value:90,valuationStatus:'sync_required'})
 })

})
