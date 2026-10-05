// Deliberately synthetic: no database, user records or financial input.
const provider = require('../src/utils/aiCliProvider');

provider.generateResponse('Reply with exactly TRADETALLY_CODEX_OK.', { provider: 'codex_cli' })
  .then(response => {
    if (response.trim() !== 'TRADETALLY_CODEX_OK') {
      throw new Error('The CLI replied but did not return the expected test response.');
    }
    console.log('Codex CLI synthetic provider check passed.');
  })
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
