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

## Disconnect the test Codex login

Run this in PowerShell (from any directory while the test container is running):

```powershell
docker exec --user appuser tradetally-test-app-1 codex logout
```

This clears the test container's saved credentials. TradeTally needs a new
ChatGPT sign-in before its Codex provider can work again. The desktop
ChatGPT/Codex login and production settings are separate and unaffected.
This command clears local credentials; it is not an account-wide session revocation.

In test, go to **Settings → AI & Integrations → AI Provider**, select another
provider or **No provider**, and save to avoid authentication errors.
Broker automatic syncs remain disabled.

To verify the saved ChatGPT login was removed without using any API key from
the container environment:

```powershell
docker exec --user appuser tradetally-test-app-1 env -u OPENAI_API_KEY -u CODEX_API_KEY codex login status
```

The expected result is `Not logged in`.

Official documentation: https://learn.chatgpt.com/docs/auth
