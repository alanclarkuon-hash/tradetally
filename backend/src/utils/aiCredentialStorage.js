const encryptionService = require('../services/brokerSync/encryptionService');
const AppError = require('./AppError');

const AI_ADMIN_CREDENTIAL_FIELDS = Object.freeze([
  'default_ai_api_key', 'default_ai_classifier_api_key', 'default_cusip_ai_api_key'
]);

// The service's isEncrypted check is only a length heuristic. Authenticate any
// apparent ciphertext before preserving it; long plaintext API keys need normal
// encryption too. Never persist the input if encryption is unavailable.
function encryptAiCredential(value) {
  if (value === null || value === undefined || value === '') return value;
  const plaintext = String(value);
  try {
    if (encryptionService.isEncrypted(plaintext)) {
      try {
        encryptionService.decrypt(plaintext);
        return plaintext;
      } catch (_) {
        // A long plaintext key can look like ciphertext. It still must be
        // encrypted below; a missing/invalid master key also fails there.
      }
    }
    return encryptionService.encrypt(plaintext);
  } catch (_) {
    // Do not retain the original exception: a provider or crypto error might
    // contain credential material and be logged by a caller.
    throw new AppError(503, {
      error: 'AI key storage unavailable',
      code: 'AI_KEY_ENCRYPTION_FAILED',
      message: 'Unable to save AI keys. Check the server encryption configuration and try again.'
    });
  }
}

module.exports = { encryptAiCredential, AI_ADMIN_CREDENTIAL_FIELDS };
