const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
test.each(['docker-compose.yaml', 'docker-compose.dev.yaml', 'docker-compose.dev2.yaml'])('%s keeps private runtime data off source binds', name => {
  const config = fs.readFileSync(path.join(root, name), 'utf8');
  expect(config).not.toMatch(/- \.\/backend\/(src\/(logs|data)|uploads):/);
  for (const volume of ['app_data', 'app_logs']) expect(config).toContain('  ' + volume + ':');
  expect(config).toContain('LOG_DIR: /app/backend/src/logs');
  expect(config).toContain('BACKUP_DIR: /app/backend/src/data/backups');
});
test('native PM2 logs use the same external storage policy', () => {
  const config = require('../../../scripts/ecosystem.config');
  for (const app of config.apps) for (const field of ['error_file', 'out_file', 'log_file']) {
    expect(app[field].startsWith(root + path.sep)).toBe(false);
  }
});
