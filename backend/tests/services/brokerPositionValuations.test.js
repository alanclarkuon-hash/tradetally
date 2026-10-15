jest.mock('../../src/config/database',()=>({query:jest.fn()}));
jest.mock('../../src/models/BrokerConnection',()=>({findById:jest.fn()}));
jest.mock('../../src/services/brokerSync/etoroService',()=>({
 get:jest.fn(),field:(o,k)=>o?.[Object.keys(o||{}).find(n=>n.toLowerCase()===k.toLowerCase())],
 flattenPositions:p=>{if(!Array.isArray(p?.positions))throw Error('Incomplete');return [...new Map([...p.positions,...(p.mirrors||[]).flatMap(m=>m.positions||[])].map(r=>[r.positionID,r])).values()];}
}));
const db=require('../../src/config/database'),BC=require('../../src/models/BrokerConnection'),etoro=require('../../src/services/brokerSync/etoroService');
const service=require('../../src/services/brokerPositionValuations');
const connection={id:'connection',userId:'owner',externalAccountId:'12'};
const position=(id='1',units=2,amount=100)=>({positionID:id,instrumentID:42,orderID:'order'+id,CID:12,units,amount,openDateTime:'2026-01-01T12:00:00Z',openRate:50,openConversionRate:1,leverage:5,isBuy:false,settlementTypeID:0,unrealizedPnL:{pnL:10,timestamp:new Date().toISOString()}});
const fixture=()=>{const raw=position();return {user_id:'owner',connection_id:'connection',account_identifier:'account',broker_type:'etoro',connection_status:'active',synced_at:'2026-01-01T12:00:00Z',positions:[{symbol:'ASSET',instrumentType:'cfd',quantity:2,totalCost:100,currentValue:90,currency:'USD'}],payload:{positions:[raw],instruments:[{instrumentId:42,symbolFull:'ASSET'}]}};};
beforeEach(()=>{jest.clearAllMocks();BC.findById.mockResolvedValue(connection);});
function response(rows){etoro.get.mockImplementation(async(c,path)=>path==='/me'?{realCid:12}:{clientPortfolio:{positions:rows,mirrors:[]}});}
test('uses exact broker USD margin plus reported P&L for short leveraged positions, without multiplying leverage or charging fees twice',async()=>{
 const row=fixture(),live=position();live.totalFees=999;live.totalExternalTaxes=888;response([live]);
 expect((await service.etoroValues(connection,row))[0]).toMatchObject({value:110,capital:100,quantity:2,status:'current'});
 expect(etoro.get.mock.calls.map(c=>c[1])).toEqual(['/me','/trading/info/real/pnl']);expect(db.query).not.toHaveBeenCalled();
});
test.each(['units','amount','leverage','isBuy','settlementTypeID','orderID','instrumentID','openRate','openConversionRate'])('changed %s cannot refresh a saved holding',async name=>{
 const row=fixture(),live=position();live[name]=typeof live[name]==='boolean'?!live[name]:typeof live[name]==='number'?live[name]+1:'changed';response([live]);
 expect((await service.etoroValues(connection,row))[0].status).toBe('sync_required');
});
test('closed and additional positions require sync; account mismatch rejects the read',async()=>{
 const row=fixture();response([]);expect((await service.etoroValues(connection,row))[0].status).toBe('sync_required');
 response([position(),position('2')]);expect((await service.etoroValues(connection,row))[0].status).toBe('sync_required');
 etoro.get.mockResolvedValue({realCid:999});await expect(service.etoroValues(connection,row)).rejects.toThrow('identity');
});
test.each([0,-10])('zero and negative remaining equity are retained (%s)',async equity=>{
 const live=position();live.unrealizedPnL.pnL=equity-100;response([live]);expect((await service.etoroValues(connection,fixture()))[0].value).toBe(equity);
});
test('malformed P&L/time does not invent a new observation, and unsupported contracts are explicit',async()=>{
 const live=position();live.unrealizedPnL.timestamp='invalid';response([live]);expect((await service.etoroValues(connection,fixture()))[0].status).toBe('unavailable');
 const row=fixture();row.positions[0].instrumentType='option';expect((await service.etoroValues(connection,row))[0].status).toBe('unsupported');
});
test('refresh is coalesced, reads only, and cached overlays expire after a sync generation change',async()=>{
 const row=fixture();row.connection_id='coalesced';BC.findById.mockResolvedValue({...connection,id:'coalesced'});response([position()]);
 db.query.mockImplementation(async sql=>({rows:sql.includes('LEFT JOIN')?[row]:[row]}));
 const original=JSON.stringify(row.positions);await Promise.all([service.read('owner',['account']),service.read('owner',['account'])]);
 await new Promise(setImmediate);const result=await service.read('owner',['account']);
 expect(result.positions[0]).toMatchObject({value:110,status:'ready'});expect(BC.findById).toHaveBeenCalledTimes(1);
 expect(service.positionsFor(row)[0].currentValue).toBe(110);expect(JSON.stringify(row.positions)).toBe(original);
 expect(service.positionsFor({...row,synced_at:new Date().toISOString()})[0].currentValue).toBe(90);
 expect(db.query.mock.calls.every(([q])=>q.trim().startsWith('SELECT'))).toBe(true);
});
test('snapshot changes during an in-flight read discard the valuation; disconnected and unsupported brokers never call an API',async()=>{
 const row=fixture();row.connection_id='racing';response([position()]);
 db.query.mockImplementation(async sql=>({rows:sql.includes('LEFT JOIN')?[row]:[{...row,synced_at:new Date().toISOString()}]}));
 await service.read('owner');await new Promise(setImmediate);expect(service.positionsFor(row)[0].currentValue).toBe(90);
 etoro.get.mockClear();db.query.mockResolvedValue({rows:[{...row,connection_id:'inactive',connection_status:'disabled'},{...row,connection_id:'ig',broker_type:'ig'}]});
 await service.read('owner');await new Promise(setImmediate);expect(etoro.get).not.toHaveBeenCalled();
});

test('saved account evidence also has to match the connected account',async()=>{
 const row=fixture();row.payload.positions[0].CID=99;response([position()]);
 expect((await service.etoroValues(connection,row))[0].status).toBe('sync_required');
});

test('an incomplete later response retains the last verified valuation and reports unavailable',async()=>{
 const row=fixture();row.connection_id='retained';BC.findById.mockResolvedValue({...connection,id:'retained'});
 db.query.mockImplementation(async()=>({rows:[row]}));let now=Date.now();const clock=jest.spyOn(Date,'now').mockImplementation(()=>now);
 try{
  response([position()]);await service.read('owner');await new Promise(setImmediate);expect((await service.read('owner')).positions[0].value).toBe(110);
  now+=31000;const bad=position();bad.unrealizedPnL.pnL=null;response([bad]);await service.read('owner');await new Promise(setImmediate);
  expect((await service.read('owner')).positions[0]).toMatchObject({value:110,status:'unavailable'});
 }finally{clock.mockRestore();}
});

test('copied positions are valued once and conflicting copied P&L is rejected',async()=>{
 const live=position();etoro.get.mockImplementation(async(c,path)=>path==='/me'?{realCid:12}:{clientPortfolio:{positions:[live],mirrors:[{positions:[{...live}]}]}});
 expect((await service.etoroValues(connection,fixture()))[0].value).toBe(110);
 etoro.get.mockImplementation(async(c,path)=>path==='/me'?{realCid:12}:{clientPortfolio:{positions:[live],mirrors:[{positions:[{...live,unrealizedPnL:{...live.unrealizedPnL,pnL:99}}]}]}});
 await expect(service.etoroValues(connection,fixture())).rejects.toThrow('Conflicting copied valuation');
});
test('selected accounts are isolated and mixed unsupported components retain oldest freshness',async()=>{
 const row={...fixture(),connection_id:'mixed'},other={...fixture(),connection_id:'other-mixed',account_identifier:'other',broker_type:'ibkr'};
 BC.findById.mockResolvedValue({...connection,id:'mixed'});response([position()]);
 db.query.mockImplementation(async sql=>({rows:sql.includes('LEFT JOIN')?[row,other]:[row]}));
 await service.read('owner');await new Promise(setImmediate);const both=(await service.read('owner')).positions[0];
 expect(both).toMatchObject({value:200,quantity:4,capital:200,status:'unsupported',asOf:'2026-01-01T12:00:00.000Z'});
 expect((await service.read('owner',['account'])).positions[0]).toMatchObject({value:110,quantity:2,status:'ready'});
 expect(db.query.mock.calls.find(([q])=>q.includes('LEFT JOIN'))[1][0]).toBe('owner');
});
