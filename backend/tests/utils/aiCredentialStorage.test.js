const { encryptAiCredential } = require('../../src/utils/aiCredentialStorage');
const encryptionService = require('../../src/services/brokerSync/encryptionService');

describe('AI credential storage with real encryption', () => {
  const originalKey = encryptionService.encryptionKey;
  beforeEach(() => { encryptionService.encryptionKey = 'synthetic-test-master-key-32-characters'; });
  afterEach(() => { encryptionService.encryptionKey = originalKey; jest.restoreAllMocks(); });

  test.each([undefined, '', 'too-short'])('rejects missing or invalid encryption configuration (%s)', masterKey => {
    encryptionService.encryptionKey = masterKey;
    expect(() => encryptAiCredential('synthetic-provider-key')).toThrow('Unable to save AI keys');
  });

  test('does not mistake a long plaintext key for authenticated ciphertext', () => {
    const key = 'synthetic-provider-key-' + 'x'.repeat(160);
    expect(encryptionService.isEncrypted(key)).toBe(true);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const encrypted = encryptAiCredential(key);
    expect(encrypted).not.toBe(key);
    expect(encryptionService.decrypt(encrypted)).toBe(key);
  });

  test('preserves authenticated ciphertext without double encryption', () => {
    const encrypted = encryptionService.encrypt('synthetic-provider-key');
    expect(encryptAiCredential(encrypted)).toBe(encrypted);
  });

  test('does not leak the input or underlying error on failure', () => {
    jest.spyOn(encryptionService, 'encrypt').mockImplementation(() => { throw new Error('synthetic-private-detail'); });
    try { encryptAiCredential('synthetic-provider-key'); throw new Error('Expected rejection'); }
    catch (error) {
      expect(error.statusCode).toBe(503);
      expect(error.body.code).toBe('AI_KEY_ENCRYPTION_FAILED');
      expect(JSON.stringify(error)).not.toMatch(/synthetic-private-detail|synthetic-provider-key/);
      expect(error.cause).toBeUndefined();
    }
  });

  test.each([null, undefined, ''])('allows clearing a key without encryption (%s)', value => {
    encryptionService.encryptionKey = undefined;
    expect(encryptAiCredential(value)).toBe(value);
  });
});
