jest.mock('../../src/config/database',()=>({query:jest.fn()}));
const {originalGroups,originalSettlementReports}=require('../../src/services/planBrokerFills');
const {reportingSettlements}=require('../../src/services/accountBrokerSettlements');
const {calculateAccountResult}=require('../../src/services/accountRealisedPnl');
const make=(id,quantity,action='buy',order='buy',price=100)=>({id,broker:'trading212',account_identifier:'account',symbol:'TEST',side:'long',instrument_type:'stock',original_currency:'USD',commission:0,fees:quantity*.1,executions:[{action,order_id:order,quantity,price,datetime:action==='buy'?'2026-01-01T12:00:00Z':'2026-01-02T12:00:00Z',fees:quantity*.1,account_currency:'GBP',broker_fx_rate:1.25}]});
const sell=(id,q)=>{const t=make(id,q,'sell','sale',110);t.executions[0].broker_result=q*8;t.executions[0].broker_result_currency='GBP';return t;};
test('reporting includes a detached sale portion once and agrees with the whole plan settlement',()=>{
 const buy=make('buy',5),exit=sell('exit',3),detached={trade:buy,execution:{...sell('detached',2).executions[0]}};
 const before=JSON.stringify([buy,exit,detached]);const groups=originalGroups([buy,exit],[detached]);const reports=reportingSettlements(groups);
 const full=originalSettlementReports(groups).canonical.get(groups.find(g=>g.fill.action==='exit').key);
 expect(reports.get('exit').pnl).toBeCloseTo(39.2);expect(reports.get('exit').pnl).toBeCloseTo(full.pnl);
 expect(reports.get('buy').events).toEqual([]);expect(reports.get('buy').pnl).toBe(0);
 expect(reports.get('exit').events[0]).toMatchObject({brokerQuantity:5,reportingQuantity:3});
 expect(JSON.stringify([buy,exit,detached])).toBe(before);
});
test('multiple matched sale portions share one broker cash result without double counting',()=>{
 const reports=reportingSettlements(originalGroups([make('buy',5),sell('a',3),sell('b',2)]));
 expect(reports.get('a').pnl+reports.get('b').pnl).toBeCloseTo(39.2);
 expect(reports.get('a').events[0].gross_pnl+reports.get('b').events[0].gross_pnl).toBe(40);
 expect(reports.get('a').events[0].time).toBe('2026-01-02T12:00:00.000Z');
});
test('matched short-cover artifacts do not create an extra realised event from an original buy',()=>{
 const cover={...make('cover',2),side:'short',pnl:25};const reports=reportingSettlements(originalGroups([make('buy',3),cover,sell('exit',5)]));
 expect(calculateAccountResult({...cover,broker_settlement:reports.get('cover')},'GBP').pnl).toBe(0);
 expect(reports.get('exit').pnl).toBeCloseTo(39.2);
});
test('separate account currencies and broker FX remain separate',()=>{
 const a=make('buy',5),b=sell('exit',5),usdBuy={...make('usd-buy',5),account_identifier:'usd'},usdSell={...sell('usd-exit',5),account_identifier:'usd'};
 for(const t of [usdBuy,usdSell])Object.assign(t.executions[0],{account_currency:'USD',broker_fx_rate:1,broker_result:t===usdSell?50:undefined,broker_result_currency:'USD'});
 const reports=reportingSettlements(originalGroups([a,b,usdBuy,usdSell]));
 expect(reports.get('exit')).toMatchObject({currency:'GBP',pnl:39.2});expect(reports.get('usd-exit')).toMatchObject({currency:'USD',pnl:49});
});
test('conflicting source evidence never produces a complete reconstructed result',()=>{
 const a=sell('a',3),b=sell('b',2);b.executions[0].broker_fx_rate=1.3;
 const reports=reportingSettlements(originalGroups([make('buy',5),a,b]));
 expect(reports.get('a').status).toBe('unavailable');expect(reports.get('b').status).toBe('unavailable');
});
