# Local test server

Open http://127.0.0.1:8089 and use the same login as the live instance.
The amber TEST ENVIRONMENT banner appears on every screen, including login.
Use this address rather than localhost so browser login cookies stay separate
from the live site at http://localhost:8088.

The `tradetally-test` Compose project has its own image, network and four named
volumes. It restores a consistent database snapshot and copies retained files
from the live instance. No production database or volumes are mounted by test.
The private test environment file has separate database and login signing secrets.
Broker auto-sync flags are turned off before the app starts. Compose keeps broker
and Plaid bank sync schedulers disabled even if the private environment enables them.
Non-broker data jobs are enabled for provider and enrichment testing, including
categories, prices, trade enrichment and daily portfolio snapshots. Trial and
retention emails, engagement messages, CRM sync and push notifications stay off.
Manual sync buttons remain available; avoid using them during design testing.

Initial setup: `node scripts/create-test-server.cjs`. It refuses an existing test
database container or database volume. Refreshing test data is a deliberate separate operation;
the test database is not refreshed automatically.

Start or rebuild only test:

```powershell
.\scripts\test-compose.ps1 up -d --build
```

Stop only test (retains its data):

```powershell
.\scripts\test-compose.ps1 stop
```

Test secrets and ingestion records live outside the checkout under
`%USERPROFILE%\TradeTally\Private\test\`: `config\test-server.env`,
`config\ingestion.compose.yaml`, `config\ig-ingester-test-relay.json`,
`ingester\Processed\`, `runtime\` and `backups\`. The launcher includes the
private ingestion mount when configured. Set `TRADETALLY_PRIVATE_DIR` to choose
another external root; the environment file must contain `TRADETALLY_TEST_ENV_FILE`
with its absolute path. Initial setup refuses a private root inside the checkout.
The host relay task must point to the external runtime and config. Production
uses separate private settings and is not modified by the test launcher.
Use a normal user-profile folder rather than AppData when desktop application
redirection prevents Windows scheduled tasks from seeing the same files.

Keep all private dumps, environment files and backups outside Git. Changes are
tested here first; deploying to the live Compose project is a separate step.
