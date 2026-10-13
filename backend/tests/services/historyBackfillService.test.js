jest.mock('../../src/config/database', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../src/services/portfolioService', () => ({ _getPositionComponents: jest.fn(), _getDailySeries: jest.fn() }));
jest.mock('../../src/services/brokerPortfolioMaintenance', () => ({ maintain: jest.fn() }));
jest.mock('../../src/utils/jobQueue', () => ({ startProcessing: jest.fn(), notifyJobEnqueued: jest.fn() }));
jest.mock('../../src/services/analyticsCache', () => ({ invalidate: jest.fn() }));
const db = require('../../src/config/database');
const portfolio = require('../../src/services/portfolioService');
const service = require('../../src/services/historyBackfillService');
beforeEach(() => { jest.clearAllMocks(); db.query.mockResolvedValue({ rows: [] }); });
test('merges overlapping requirements without dropping older or closed instrument history', () => {
  const tasks = new Map();
  service.addTask(tasks, 'BTC', 'crypto', '2025-01-01', '2025-02-01');
  service.addTask(tasks, 'BTC', 'crypto', '2026-01-01', '2026-02-01');
  service.addTask(tasks, 'BTC', 'stock', '2026-01-01', '2026-02-01');
  expect([...tasks.values()]).toHaveLength(2);
  expect(tasks.get('crypto:BTC')).toMatchObject({ from: '2025-01-01', to: '2026-02-01' });
});
test('pending requests are deduplicated in a database transaction and wake the worker', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'existing' }] }) };
  db.withTransaction.mockImplementation(fn => fn(client));
  expect(await service.enqueue('owner')).toBe('existing');
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(require('../../src/utils/jobQueue').notifyJobEnqueued).toHaveBeenCalledWith([service.TYPE]);
});
test('resume keeps completed tasks, reports missing dates and runs reconstruction after downloads', async () => {
  portfolio._getDailySeries.mockResolvedValue([]);
  require('../../src/services/brokerPortfolioMaintenance').maintain.mockResolvedValue({ warnings: [] });
  const result = await service.process({ id: 'job', user_id: 'owner', result: {
    tasks: [{ symbol: 'BTC', instrumentType: 'crypto', from: '2026-01-01', to: '2026-01-02' }, { symbol: 'ETH', instrumentType: 'crypto', from: '2026-01-01', to: '2026-01-02' }],
    processed: 1, complete: 1, gaps: [], total: 2, stage: 'prices'
  } });
  expect(portfolio._getDailySeries).toHaveBeenCalledTimes(1);
  expect(portfolio._getDailySeries.mock.calls[0][0]).toBe('ETH');
  expect(result).toMatchObject({ processed: 2, complete: 1, stage: 'finished', gaps: [{ symbol: 'ETH' }] });
  expect(require('../../src/services/brokerPortfolioMaintenance').maintain).toHaveBeenCalledWith('owner', expect.objectContaining({ fetchPrices: true,onProgress:expect.any(Function) }));
});
test('status is scoped to the authenticated user and excludes task plans and credentials', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'job', status: 'processing', result: { tasks: [{ secret: 'hidden' }], processed: 1, total: 2, gaps: [] } }] });
  const result = await service.status('owner');
  expect(db.query.mock.calls[0][1]).toEqual(['owner', service.TYPE]);
  expect(result[0].tasks).toBeUndefined();
});
test('dedicated worker claims only history jobs atomically without enrichment timeouts', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'history' }] });
  expect(await service.claim()).toEqual({ id: 'history' });
  expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
  expect(db.query.mock.calls[0][1]).toEqual([service.TYPE]);
  const config = require('../../src/utils/jobQueueConfig');
  expect(config.DEDICATED_JOB_TYPES).toContain(service.TYPE);
  expect(config.PARALLEL_JOB_TYPES).not.toContain(service.TYPE);
});
test('existing displayed gaps are recalculated without fetching prices; only full closures disappear',async()=>{
 db.query.mockResolvedValueOnce({rows:[{id:'job',status:'completed',result:{processed:2,total:2,complete:0,gaps:[
  {symbol:'SPY',instrumentType:'stock',calendar:'US',ranges:[{from:'2025-04-18',to:'2025-04-18'},{from:'2026-01-19',to:'2026-01-19'}]},
  {symbol:'BTC',instrumentType:'crypto',ranges:[{from:'2025-04-18',to:'2025-04-18'}]}
 ]}}]});
 const [result]=await service.status('owner');
 expect(result.complete).toBe(1); expect(result.gaps).toHaveLength(1); expect(result.gaps[0].symbol).toBe('BTC');
 expect(portfolio._getDailySeries).not.toHaveBeenCalled();
});

test('an active job is shown before a newer queued follow-up',async()=>{db.query.mockResolvedValue({rows:[{id:'queued',status:'pending',created_at:'2026-01-02',result:{}},{id:'active',status:'processing',created_at:'2026-01-01',result:{processed:1,total:2}}]});const r=await service.status('owner');expect(r.map(j=>j.id)).toEqual(['active','queued']);expect(db.query.mock.calls[0][0]).toContain("WHEN 'processing' THEN 0");});

test('portfolio activity is persisted separately from worker heartbeat and returned without task plans',async()=>{
 require('../../src/services/brokerPortfolioMaintenance').maintain.mockImplementation(async(_user,{onProgress})=>{
  await onProgress({stage:'prices',accountName:'Synthetic account',accountProcessed:1,accountTotal:3,processed:4,total:9,currentSymbol:'SYNTH'});
  return {warnings:[]};
 });
 const result=await service.process({id:'job',user_id:'owner',result:{tasks:[],processed:0,total:0,gaps:[],stage:'prices'}});
 expect(result.lastHeartbeatAt).toBeTruthy();expect(result.lastProgressAt).toBeTruthy();
 expect(result.portfolioProgress).toMatchObject({accountName:'Synthetic account',processed:4,total:9});
 db.query.mockResolvedValue({rows:[{id:'job',status:'processing',result}]});
 const [status]=await service.status('owner');expect(status.lastHeartbeatAt).toBe(result.lastHeartbeatAt);expect(status.portfolioProgress.currentSymbol).toBe('SYNTH');expect(status.tasks).toBeUndefined();
});

test('restarting during portfolio reconstruction does not repeat completed price or calendar work',async()=>{
 const calendar=jest.spyOn(require('../../src/services/exchangeCalendar'),'resolve');
 require('../../src/services/brokerPortfolioMaintenance').maintain.mockResolvedValue({warnings:[]});
 await service.process({id:'job',user_id:'owner',result:{tasks:[{symbol:'SYNTH',instrumentType:'stock'}],processed:1,total:1,gaps:[{symbol:'SYNTH',instrumentType:'stock',calendar:null}],stage:'portfolio'}});
 expect(portfolio._getDailySeries).not.toHaveBeenCalled();expect(calendar).not.toHaveBeenCalled();calendar.mockRestore();
});


test('pending scoped requests union accounts and use earliest dates while full maintenance dominates',async()=>{
 const client={query:jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:'pending',data:{scope:{accounts:{a:'2026-10-01'}}}}]}).mockResolvedValue({rows:[]})};
 db.withTransaction.mockImplementation(fn=>fn(client));
 expect(await service.enqueue('owner',{accounts:{a:'2026-09-01',b:'2026-10-02'}})).toBe('pending');
 expect(JSON.parse(client.query.mock.calls[2][1][1]).scope).toEqual({accounts:{a:'2026-09-01',b:'2026-10-02'}});
 expect(service.mergeScope({accounts:{a:'2026-01-01'}},null)).toBeNull();
 expect(service.mergeScope({accounts:{a:null}},{accounts:{a:'2026-01-01'}})).toEqual({accounts:{a:null}});
});
test('empty sync changes enqueue nothing and resumed cursors are excluded from merge candidates',async()=>{
 expect(await service.enqueue('owner',{accounts:{}})).toBeNull();expect(db.withTransaction).not.toHaveBeenCalled();
 const client={query:jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:'followup'}]})};
 db.withTransaction.mockImplementation(fn=>fn(client));
 expect(await service.enqueue('owner',{accounts:{a:'2026-10-01'}})).toBe('followup');
 expect(client.query.mock.calls[1][0]).toContain('result IS NULL');
 expect(JSON.parse(client.query.mock.calls[2][1][2]).scope).toEqual({accounts:{a:'2026-10-01'}});
});
test('scoped price planning queries only affected accounts and clamps old holdings to changed dates',async()=>{
 db.query.mockImplementation(async sql=>({rows:sql.includes('FROM trades')?[{symbol:'AAA',instrument_type:'stock',entry_time:'2020-01-01'}]:sql.includes('broker_import_snapshots')?[{broker_type:'kraken',payload:{ledger:{old:{asset:'OLD',time:1577836800}}}}]:[]}));
 portfolio._getPositionComponents.mockResolvedValue([{symbol:'BTC',instrumentType:'crypto',effectiveDate:'2020-01-01'}]);
 const tasks=await service.plan('owner',{accounts:{a:'2026-10-01'}});
 expect(tasks.every(t=>t.from==='2026-10-01')).toBe(true);
 expect(tasks.map(t=>t.symbol)).not.toContain('OLD');
 expect(portfolio._getPositionComponents).toHaveBeenCalledWith('owner',['a']);
 expect(db.query.mock.calls[0][1]).toEqual(['owner',['a']]);
});
test('processing a persisted scope keeps reconstruction within those accounts and dates',async()=>{
 require('../../src/services/brokerPortfolioMaintenance').maintain.mockResolvedValue({warnings:[]});
 await service.process({id:'job',user_id:'owner',data:{scope:{accounts:{a:'2026-10-01'}}},result:{tasks:[],processed:0,total:0,gaps:[],stage:'portfolio'}});
 expect(require('../../src/services/brokerPortfolioMaintenance').maintain).toHaveBeenCalledWith('owner',expect.objectContaining({accountIdentifiers:['a'],fromDates:{a:'2026-10-01'}}));
});


test('native contracts remain explicit coverage limitations without stock downloads or listing lookups',async()=>{
 portfolio._getPositionComponents.mockResolvedValue([]);
 db.query.mockImplementation(async sql=>({rows:sql.includes('FROM trades')?[{symbol:'IX.D.SYNTH.DAILY',instrument_type:'spread_bet',entry_time:'2026-01-01'}]:[]}));
 const tasks=await service.plan('owner');
 expect(tasks).toHaveLength(1);expect(tasks[0]).toMatchObject({unsupported:true,instrumentType:'spread_bet'});
 portfolio._getDailySeries.mockClear();const calendar=jest.spyOn(require('../../src/services/exchangeCalendar'),'resolve');
 require('../../src/services/brokerPortfolioMaintenance').maintain.mockResolvedValue({warnings:[]});
 const result=await service.process({id:'job',user_id:'owner',result:{tasks,processed:0,complete:0,gaps:[],total:1,stage:'prices'}});
 expect(portfolio._getDailySeries).not.toHaveBeenCalled();expect(calendar).not.toHaveBeenCalled();
 expect(result).toMatchObject({processed:1,complete:0,gaps:[{unsupported:true,ranges:[]}]});
 db.query.mockResolvedValue({rows:[{id:'job',status:'completed',result}]});
 expect((await service.status('owner'))[0].gaps[0].unsupported).toBe(true);calendar.mockRestore();
});

 test.each([['same',false],['conflict',true]])('open positions reuse account-verified listing only with unanimous evidence: %s',async(_label,conflict)=>{
 const rows=[{symbol:'EXAMPLE',account_identifier:'a',instrument_type:'stock',entry_time:'2022-01-01'}, {symbol:'EXAMPLE',account_identifier:'b',instrument_type:'stock',entry_time:'2022-01-01'}];
 db.query.mockImplementation(async sql=>({rows:sql.includes('FROM trades')?rows:[]}));
 portfolio._getPositionComponents.mockResolvedValue([{symbol:'EXAMPLE',instrumentType:'stock',accountIdentifiers:['a','b'],effectiveDate:'2022-01-01'}]);
 const mapping=jest.spyOn(require('../../src/services/brokerInstrumentSymbols'),'applyTradeHistoricalSymbols').mockImplementation(async(_db,_user,trades)=>{for(const t of trades)t.history_market_symbol=conflict&&t.account_identifier==='b'?'EXAMPLE.DE':'EXAMPLE.L'});
 try{
 const tasks=await service.plan('owner');
 expect(tasks.some(t=>t.symbol==='EXAMPLE')).toBe(conflict);
 expect(tasks.some(t=>t.symbol==='EXAMPLE.L')).toBe(true);
 }finally{mapping.mockRestore()}
 });

 test('old OTC coverage reports remove closed days without hiding genuine missing sessions or downloading',async()=>{
 db.query.mockImplementation(async sql=>({rows:sql.includes('FROM job_queue')?[{id:'old-job',status:'completed',result:{processed:2,total:2,complete:0,gaps:[
 {symbol:'SYNTHETIC_OTC_HOLIDAYS',instrumentType:'stock',calendar:null,ranges:['2024-12-25','2025-01-01','2025-01-09','2025-01-20','2025-02-17'].map(day=>({from:day,to:day}))},
 {symbol:'SYNTHETIC_OTC_SESSION',instrumentType:'stock',calendar:null,ranges:[{from:'2025-01-09',to:'2025-01-10'}]}]}}]:[{exchange:'OQX',source:'yahoo'}]}));
 const [r]=await service.status('owner');
 expect(r.complete).toBe(1);expect(r.gaps).toHaveLength(1);
 expect(r.gaps[0]).toMatchObject({symbol:'SYNTHETIC_OTC_SESSION',calendar:'US',ranges:[{from:'2025-01-10',to:'2025-01-10'}]});
 expect(portfolio._getDailySeries).not.toHaveBeenCalled();
 });

test.each([['2023-09-14','2023-09-14'],['2021-09-14','2023-08-15']])('plan trims optional IPO padding only when actual held date %s permits it',async(entered,expected)=>{
 const meta={currency:'USD',listing:{source:'yahoo',meta:{symbol:'SYNTH',currency:'USD',exchangeName:'NMS',firstTradeDate:Date.parse('2023-09-14')/1000}}};
 db.query.mockImplementation(async sql=>({rows:sql.includes('FROM trades')?[{symbol:'SYNTH',instrument_type:'stock',entry_time:entered}]:sql.includes('FROM portfolio_reconstruction_prices')?[{symbol:'SYNTH',payload:meta}]:[]}));
 portfolio._getPositionComponents.mockResolvedValue([]);
 const scope={accounts:{a:'2023-08-15'}},tasks=await service.plan('owner',scope);expect(tasks.find(t=>t.symbol==='SYNTH').from).toBe(expected);
});
test('an earlier contributing account prevents combined listing padding from hiding old holdings',async()=>{
 const meta={currency:'USD',listing:{source:'yahoo',meta:{symbol:'SYNTH',currency:'USD',exchangeName:'NMS',firstTradeDate:Date.parse('2023-09-14')/1000}}};
 db.query.mockImplementation(async(sql,args)=>({rows:sql.includes('FROM trades')?[{symbol:'SYNTH',instrument_type:'stock',entry_time:args[1][0]==='new'?'2023-09-14':'2021-09-14'}]:sql.includes('FROM portfolio_reconstruction_prices')?[{symbol:'SYNTH',payload:meta}]:[]}));
 portfolio._getPositionComponents.mockResolvedValue([]);const tasks=await service.plan('owner',{accounts:{new:'2023-08-15',old:'2023-08-15'}});expect(tasks.find(t=>t.symbol==='SYNTH').from).toBe('2023-08-15');
});

test('closed price requirements stop at the last held day while open lots stay current',async()=>{
 jest.useFakeTimers().setSystemTime(new Date('2026-10-13T12:00:00Z'));
 portfolio._getPositionComponents.mockResolvedValue([]);
 db.query.mockImplementation(async sql=>({rows:sql.startsWith('SELECT symbol,instrument_type')?[
  {symbol:'CLOSED',broker:'other',instrument_type:'stock',entry_time:'2026-09-01T12:00:00Z',exit_time:'2026-09-30T16:00:00Z'},
  {symbol:'OPEN',broker:'other',instrument_type:'stock',entry_time:'2026-09-01T12:00:00Z'},
  {symbol:'DAY',broker:'other',instrument_type:'stock',entry_time:'2026-09-01T12:00:00Z',exit_time:'2026-09-01T16:00:00Z'}
 ]:[]}));
 const tasks=await service.plan('owner');
 expect(tasks.find(t=>t.symbol==='CLOSED').to).toBe('2026-09-29');
 expect(tasks.find(t=>t.symbol==='OPEN').to).toBe('2026-10-12');
 expect(tasks.find(t=>t.symbol==='DAY').to).toBe('2026-09-01');
 jest.useRealTimers();
});

test('unsupported history respects scoped ownership and merges repeated lots',async()=>{
 jest.useFakeTimers().setSystemTime(new Date('2026-10-13T12:00:00Z'));
 portfolio._getPositionComponents.mockResolvedValue([]);
 db.query.mockImplementation(async sql=>({rows:sql.startsWith('SELECT symbol,instrument_type')?[
  {symbol:'IX.D.OLD.DAILY',instrument_type:'spread_bet',entry_time:'2025-01-01',exit_time:'2025-02-01'},
  {symbol:'IX.D.HELD.DAILY',instrument_type:'spread_bet',entry_time:'2025-01-01',exit_time:'2026-02-01'},
  {symbol:'IX.D.HELD.DAILY',instrument_type:'spread_bet',entry_time:'2026-03-01',exit_time:'2026-04-01'}
 ]:[]}));
 try {
  const tasks=await service.plan('owner',{accounts:{a:'2026-01-01'}});
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({symbol:'IX.D.HELD.DAILY',unsupported:true,from:'2026-01-01',to:'2026-03-31'});
 } finally {jest.useRealTimers();}
});
test('unsupported positions obey the scope floor and combined accounts retain earlier requirements',async()=>{
 jest.useFakeTimers().setSystemTime(new Date('2026-10-13T12:00:00Z'));
 db.query.mockResolvedValue({rows:[]});
 portfolio._getPositionComponents.mockImplementation(async(_user,accounts)=>[{symbol:'IX.D.HELD.DAILY',instrumentType:'spread_bet',effectiveDate:accounts[0]==='a'?'2025-01-01':'2026-02-01'}]);
 try {
  const tasks=await service.plan('owner',{accounts:{a:'2026-01-01',b:'2026-03-01'}});
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({unsupported:true,from:'2026-01-01',to:'2026-10-12'});
 } finally {jest.useRealTimers();}
});
