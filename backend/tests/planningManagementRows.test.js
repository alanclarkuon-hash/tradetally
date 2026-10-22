const {definitionForManagement}=require('../src/services/planningManagementRows');
const {verifyAllocation,ledger}=require('../src/services/planningLedger');
const {stageAccount}=require('../src/services/planningAccounts');
const plan=()=>({definition:{symbol:'TEST',instrument:'stock',direction:'long',currency:'USD',accountId:'one',accountIds:['one','two'],stopPrice:90,entries:[{key:'a'}],exits:[]},management:{entry:{extra:{stage:{label:'Added',accountId:'two',riskWeight:0},executed:true,units:1,price:100,time:'2026-01-01T00:00:00Z'}},exit:{}}});
test('additional row routing and provisional ledger use the selected plan account',()=>{
 const p=plan(),definition=definitionForManagement(p);expect(stageAccount(definition,'entry','extra')).toBe('two');
 const result=ledger(p,[],[]);expect(result.records[0].accountId).toBe('two');expect(p.definition.entries).toEqual([{key:'a'}]);
});
test('allocation validator accepts saved additions but rejects unknown keys',()=>{
 const p=plan(),fill={action:'entry',quantity:2},trade={symbol:'TEST',instrument_type:'stock',side:'long'};
 expect(()=>verifyAllocation(p,fill,1,0,'entry','extra',trade)).not.toThrow();
 expect(()=>verifyAllocation(p,fill,1,0,'entry','not_saved',trade)).toThrow('Ladder row not found');
});
test('saved additions join exit sizing without mutating original exit targets',()=>{
 const p=plan();p.definition.quantityStep=1;p.management.exit={extra:{stage:{label:'Additional exit',accountId:'two',riskWeight:0},price:120,percent:50,units:1,executed:false,time:'2026-01-01T00:00:00Z'}};
 const state=require('../src/services/planningExitSizing').state(p,{records:[{accountId:'two',valid:true,action:'entry',stage_key:'extra',quantity:2}]});
 expect(state.accounts.find(a=>a.accountId==='two').rows[0]).toMatchObject({key:'extra',quantity:1,suggested:1});expect(p.definition.exits).toEqual([]);
});
