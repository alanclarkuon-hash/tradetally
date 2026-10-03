# Local test server

Open http://127.0.0.1:8089 and use the same login as the live instance.
The amber TEST ENVIRONMENT banner appears on every screen, including login.
Use this address rather than localhost so browser login cookies stay separate
from the live site at http://localhost:8088.

The `tradetally-test` Compose project has its own image, network and four named
volumes. It restores a consistent database snapshot and copies retained files
from the live instance. No production database or volumes are mounted by test.
The private test environment file has separate database and login signing secrets.
Broker auto-sync flags are turned off before the app starts, and background jobs
are disabled in Compose even if a copied setting is subsequently changed.
Manual sync buttons remain available; avoid using them during design testing.

Initial setup: `node scripts/create-test-server.cjs`. It refuses an existing test
database container or database volume. Refreshing test data is a deliberate separate operation;
the test database is not refreshed automatically.

Start or rebuild only test:

```powershell
docker compose -f compose.test.yaml --env-file .local/backup-secrets/test-server.env up -d --build
```

Stop only test (retains its data):

```powershell
docker compose -f compose.test.yaml --env-file .local/backup-secrets/test-server.env stop
```

Keep all private dumps, environment files and backups outside Git. Changes are
tested here first; deploying to the live Compose project is a separate step.
