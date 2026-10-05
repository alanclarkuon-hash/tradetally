# Codex CLI on the test server

Issue: https://github.com/alanclarkuon-hash/tradetally/issues/24

The test Compose configuration installs pinned Codex CLI 0.160.0. The normal
Docker build leaves the CLI disabled unless `CODEX_CLI_VERSION` is explicitly set.
Production is not changed by this setup.

Authentication lives in the dedicated `tradetally-test_codex_auth` Docker volume,
not the repository, test database, production or desktop Codex login. Never copy
or commit its contents. Removing Compose volumes also removes this login.

From the repository directory, sign in as the backend service user:

```powershell
docker compose --env-file .local/backup-secrets/test-server.env -f compose.test.yaml exec --user appuser app codex login --device-auth
```

Complete the displayed OpenAI sign-in yourself. Device sign-in may need enabling
in ChatGPT security settings. Do not send login codes, passwords or auth files
through chat. Check authentication with:

```powershell
docker compose --env-file .local/backup-secrets/test-server.env -f compose.test.yaml exec --user appuser app codex login status
```

Then choose **OpenAI Codex CLI** in test Settings → AI Provider. Leave the model
blank to use the CLI default. Before requesting analysis, run this synthetic check:

```powershell
docker compose --env-file .local/backup-secrets/test-server.env -f compose.test.yaml exec --user appuser app node /app/backend/scripts/test-codex-cli.js
```

It exercises TradeTally's actual provider runner without reading financial data.
Keep the separate CUSIP/background default provider unchanged during evaluation.

The runner sends only its supplied prompt, uses an empty temporary working
directory and ephemeral sessions, disables command/web tools, ignores user
configuration/rules, and filters out backend/provider credentials. On test it
requires ChatGPT authentication, preventing an implicit switch to API-key billing.
Analysis prompts are sent to OpenAI and consume the signed-in plan's allowance.
The CLI is text-only here; screenshot analysis is unsupported.

To disconnect, run the same Compose command with `codex logout` and select another
AI provider in test settings. Broker automatic syncs remain disabled.

Official documentation: https://learn.chatgpt.com/docs/auth
