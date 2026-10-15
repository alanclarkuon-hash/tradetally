jest.mock('../../src/config/database', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../../src/services/brokerSync/encryptionService', () => ({
  isEncrypted: jest.fn(() => false), encrypt: jest.fn(value => 'enc:' + value), decrypt: jest.fn()
}));
const db = require('../../src/config/database');
const encryptionService = require('../../src/services/brokerSync/encryptionService');
const adminSettings = require('../../src/services/adminSettings');

describe('Administrator AI credential writes', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { jest.restoreAllMocks(); });

  test.each(['default_ai_api_key', 'default_ai_classifier_api_key', 'default_cusip_ai_api_key'])('does not persist %s after an encryption failure', async field => {
    encryptionService.encrypt.mockImplementationOnce(() => { throw new Error('synthetic-sensitive-detail'); });
    expect(await adminSettings.updateSetting(field, 'synthetic-key')).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('synthetic-sensitive-detail');
  });

  test('rolls back the entire batch when credential encryption fails', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    db.pool.connect.mockResolvedValue(client);
    encryptionService.encrypt.mockImplementationOnce(() => { throw new Error('synthetic-sensitive-detail'); });
    expect(await adminSettings.updateSettings({ default_ai_provider: 'openai', default_ai_api_key: 'synthetic-key' })).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('encrypts a valid key and permits clearing it without encryption', async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect(await adminSettings.updateSetting('default_ai_api_key', 'synthetic-key')).toBe(true);
    expect(db.query.mock.calls[0][1]).toEqual(['default_ai_api_key', 'enc:synthetic-key']);
    encryptionService.encrypt.mockClear();
    expect(await adminSettings.updateSetting('default_ai_api_key', '')).toBe(true);
    expect(encryptionService.encrypt).not.toHaveBeenCalled();
  });
});
