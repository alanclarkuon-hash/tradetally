import {describe,it,expect} from 'vitest'
import {describeManagementEvent} from './managementTimeline'
const definition={currency:'USD',entries:[{key:'a',label:'Fib 0.616'}],exits:[{key:'runner',label:'Runner'}]}
const event=(previous,next)=>({event_type:'management_updated',snapshot:{previous,next}})
describe('management action descriptions',()=>{
 it('distinguishes entry execution, reversal and exit execution with their row names',()=>{
  expect(describeManagementEvent(event({entry:{a:{executed:false,units:2,price:100}}},{entry:{a:{executed:true,units:2,price:100}}}),definition)).toEqual([{title:'Entry marked as executed · Fib 0.616',detail:'2 units @ US$100.00 · User-reported execution'}])
  expect(describeManagementEvent(event({entry:{a:{executed:true}}},{entry:{a:{executed:false}}}),definition)[0].title).toContain('execution mark removed')
  expect(describeManagementEvent(event({}, {exit:{runner:{executed:true,units:1,price:120}}}),definition)[0].title).toBe('Exit marked as executed · Runner')
 })
 it('identifies separate quantity, price and tag changes with previous and next values',()=>{
  const result=describeManagementEvent(event({entry:{a:{units:2,price:100,tactics:['Breakout'],marketContext:[]}}},{entry:{a:{units:3,price:101,tactics:['VWAP'],marketContext:['Bullish']}}}),definition)
  expect(result.map(r=>r.title)).toEqual(['Entry quantity changed · Fib 0.616','Entry price level changed · Fib 0.616','Entry tactic tags changed · Fib 0.616','Entry market context tags changed · Fib 0.616'])
  expect(result[0].detail).toBe('2 → 3')
 })
 it('omits untouched initial rows and timestamp-only legacy saves',()=>{expect(describeManagementEvent(event({}, {entry:{a:{executed:false,units:2,price:100}}}),definition)).toEqual([]);expect(describeManagementEvent(event({entry:{a:{executed:true,time:'2026-01-01'}}},{entry:{a:{executed:true,time:'2026-01-02'}}}),definition)).toEqual([])})
 it('describes broker linking, stop reasons and credit rolls',()=>{expect(describeManagementEvent({event_type:'trade_linked',snapshot:{action:'exit',stageKey:'runner',quantity:1,source:{price:120,currency:'USD'}}},definition)[0].title).toBe('Exit trade linked · Runner');expect(describeManagementEvent({event_type:'stop_changed',snapshot:{previous:90,next:95,currency:'USD',reason:'Protect gains'}},definition)[0].detail).toContain('Protect gains');expect(describeManagementEvent({event_type:'option_rolled',snapshot:{netCredit:50,currency:'USD',reason:'Reduce exposure'}},definition)[0].detail).toContain('Reduce exposure')})
})

it('describes a quantity override reset as returning to calculated sizing',()=>{expect(describeManagementEvent(event({entry:{a:{executed:false,units:0}}},{entry:{a:{executed:false,units:null}}}),definition)).toEqual([{title:'Entry quantity changed · Fib 0.616',detail:'0 → Calculated'}])})
