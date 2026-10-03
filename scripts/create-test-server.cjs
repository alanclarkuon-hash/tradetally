// Initial setup only: refuses an existing test database/container.
// No private data is written outside the ignored, protected .local directories.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { command } = require('./backup-offsite.cjs');
const ROOT = path.resolve(__dirname, '..');
const ENV = '.local/backup-secrets/test-server.env';
const compose = ['compose', '-f', 'compose.test.yaml', '--env-file', ENV];

async function main() {
  const work = await fs.mkdtemp(path.join(ROOT, '.local/backup-staging/test-'));
  try {
    // Query before changing anything. Compose interpolation needs an environment file.
    const existing = path.join(work, 'existing.txt');
    await command('docker', ['compose', '-f', 'compose.test.yaml', '--env-file', '.env', 'ps', '--all', '--quiet', 'postgres'], existing);
    if ((await fs.readFile(existing, 'utf8')).trim()) throw Error('Test server already exists; initial setup refused');
    const volumes = path.join(work, 'volumes.txt');
    await command('docker', ['volume', 'ls', '--format', '{{.Name}}', '--filter', 'name=tradetally-test_postgres_data'], volumes);
    if ((await fs.readFile(volumes, 'utf8')).split(/\r?\n/).includes('tradetally-test_postgres_data')) throw Error('Existing test data must not be overwritten');
    const liveEnv = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    const overrides = `\nDB_PASSWORD=${crypto.randomBytes(32).toString('hex')}\nJWT_SECRET=${crypto.randomBytes(48).toString('hex')}\nDB_NAME=tradetally_test\nDB_HOST=postgres\n`;
    await fs.writeFile(path.join(ROOT, ENV), liveEnv + overrides, { flag: 'wx' });
    const dump = path.join(work, 'database.dump');
    await command('docker', ['compose', '-f', 'compose.local.yaml', 'exec', '-T', 'postgres', 'sh', '-c', 'exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"'], dump);
    const files = path.join(work, 'files.tar.gz');
    await command('docker', ['compose', '-f', 'compose.local.yaml', 'exec', '-T', 'app', 'tar', '-czf', '-', '--exclude=backend/src/data/backups', '--exclude=backend/src/data/logs', '-C', '/app', 'backend/uploads', 'backend/src/data'], files);
    await command('docker', [...compose, 'up', '-d', '--wait', 'postgres']);
    await command('docker', [...compose, 'exec', '-T', 'postgres', 'sh', '-c', 'exec pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d tradetally_test'], null, dump);
    // Disable copied schedules before the test backend can ever start.
    await command('docker', [...compose, 'exec', '-T', 'postgres', 'sh', '-c', 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d tradetally_test -c "UPDATE broker_connections SET auto_sync_enabled=false, next_scheduled_sync=NULL"']);
    await command('docker', [...compose, 'build', 'app']);
    // A one-off shell creates only test volumes; the server entrypoint does not run.
    await command('docker', [...compose, 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'app', '-c', 'tar -xzf - -C /app'], null, files);
    await command('docker', [...compose, 'up', '-d', '--wait', 'app']);
    console.log('Test server ready at http://127.0.0.1:8089; copied broker auto-syncs disabled.');
  } finally {
    if (path.dirname(work) !== path.join(ROOT, '.local/backup-staging')) throw Error('Unsafe staging path');
    await fs.rm(work, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error('Test setup did not complete. Review the test containers before retrying; production was not modified.');
  process.exitCode = 1;
});
