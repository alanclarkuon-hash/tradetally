jest.mock('../../src/config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../src/utils/currencyConverter',()=>({convertToUSD:jest.fn()}));
const {statementAnnotations,importStatementAnnotations}=require('../../src/services/brokerSync/trading212StatementAnnotations');
const db=require('../../src/config/database');
const fx=require('../../src/utils/currencyConverter');
const header='Action,Time (UTC),Notes,ID,Total,Currency (Total)\n';
const reserved='Withdrawal,2024-01-01 12:00:00+00:00,blocked for rights issue (TEST),blocked,-12.00,GBP\n';
const executed='Deposit,2024-01-05 12:00:00+00:00,rights issue executed (TEST),executed,12.00,GBP\n';

test('rights execution consumes previously reserved cash without inventing funding',()=>{
  expect(statementAnnotations(header+reserved+executed)).toEqual([
    expect.objectContaining({type:'corporate_action',amount:-12,originalAmount:-12}),
    expect.objectContaining({type:'corporate_action',amount:0,originalAmount:12})]);
  expect(statementAnnotations(header+reserved+reserved+executed)).toHaveLength(2);
});
test('rejects unmatched rights executions and mismatched reservation amounts',()=>{
  expect(()=>statementAnnotations(header+executed)).toThrow('matching reserved');
  expect(()=>statementAnnotations(header+reserved+executed.replace(',12.00,',',13.00,'))).toThrow('matching reserved');
});
test('classifies dividend adjustments and rights proceeds without changing actual payments',()=>{
  const rows=statementAnnotations(header+
    'Dividend adjustment,2024-01-01 12:00:00+00:00,Withholding adjustment,div,0.30,GBP\n'+
    'Result adjustment,2024-01-02 12:00:00+00:00,Proceeds from sale of TEST rights,rights,0.40,GBP\n'+
    'Deposit,2024-01-02 12:00:00+00:00,Bank transfer,bank,100.00,GBP\n');
  expect(rows).toEqual([expect.objectContaining({type:'dividend',amount:0.3}),expect.objectContaining({type:'corporate_action',amount:0.4})]);
});
test('annotations require an existing owner-scoped API identity with matching amount, currency and date',async()=>{
  db.query.mockResolvedValue({rows:[{id:'account',currency:'GBP'}]});
  fx.convertToUSD.mockResolvedValue({amountUSD:-15,exchangeRate:1.25});
  const client={query:jest.fn().mockResolvedValue({rows:[]})};
  db.withTransaction.mockImplementation(fn=>fn(client));
  await expect(importStatementAnnotations({userId:'owner',externalAccountId:'1234'},header+reserved)).rejects.toThrow('does not match');
  expect(client.query.mock.calls[0][1]).toEqual(['owner','account','transactions:blocked','corporate_action',-12,-15,
    'Withdrawal: blocked for rights issue (TEST)',-12,'GBP','2024-01-01']);
});
