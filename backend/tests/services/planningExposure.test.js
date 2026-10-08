
const {recommend}=require('../../src/services/planningExposure');
const events=values=>values.map((r,i)=>({r,eligible:r!=null,time:String(i).padStart(3,'0')}));
test('three wins recommend one step up; five losses one step down',()=>{expect(recommend(.1,events([1,2,1])).level).toBe(.2);expect(recommend(.2,events([-1,-1,-1,-1,-1])).level).toBe(.1)});
test('breakeven retains the streak and unresolved evidence interrupts it',()=>{expect(recommend(.1,events([1,0,1,.05,1])).level).toBe(.2);expect(recommend(.1,events([1,1,null,1])).level).toBe(.1)});
test('level recommendations stay within limits and never invent an applied level',()=>{expect(recommend(.3,events([1,1,1])).level).toBe(.3);expect(recommend(.05,events([-1,-1,-1,-1,-1])).level).toBe(.05);expect(recommend(undefined,events([1,1,1])).level).toBeNull()});
