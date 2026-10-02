jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/services/brokerSync/encryptionService', () => ({
  encrypt: jest.fn(value => `encrypted:${value}`),
  decrypt: jest.fn(value => String(value).replace('encrypted:', ''))
}));
const db = require('../../src/config/database');
const BrokerConnection = require('../../src/models/BrokerConnection');
const row = { id: 'connection', user_id: 'owner', broker_type: 'etoro',
  etoro_api_key: 'encrypted:public', etoro_user_key: 'encrypted:user', external_account_id: '123',
  broker_environment: 'real', broker_metadata: { currency: 'USD', import_pending_review: true } };

test('ordinary API responses omit encrypted and decrypted credentials', () => {
  const formatted = BrokerConnection.formatConnection(row, false);
  expect(JSON.stringify(formatted)).not.toContain('encrypted');
  expect(formatted).not.toHaveProperty('etoroApiKey');
  expect(formatted).not.toHaveProperty('etoroUserKey');
  expect(BrokerConnection.formatConnection(row, true)).toMatchObject({ etoroApiKey: 'public', etoroUserKey: 'user' });
});

test('persists both keys encrypted and keeps the first connection manual', async () => {
  db.query.mockResolvedValue({ rows: [row] });
  await BrokerConnection.create('owner', { brokerType: 'etoro', etoroApiKey: 'public', etoroUserKey: 'user',
    externalAccountId: '123', autoSyncEnabled: true });
  const [sql, params] = db.query.mock.calls[0];
  expect(params).toContain('encrypted:public');
  expect(params).toContain('encrypted:user');
  expect(params).not.toContain('public');
  expect(params).not.toContain('user');
  expect(sql).toContain("false,'manual'");
});
