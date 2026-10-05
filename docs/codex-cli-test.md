# Codex CLI on the test server

Issue: https://github.com/alanclarkuon-hash/tradetally/issues/24

The test Compose configuration installs pinned Codex CLI 0.160.0. The normal
Docker build leaves the CLI disabled unless `CODEX_CLI_VERSION` is explicitly set.
The local production Compose configuration also opts into this version following
release authorization. Test and production use separate login volumes.

Authentication lives in the dedicated `tradetally-test_codex_auth` Docker volume,
not the repository, test database, production or desktop Codex login. Never copy
or commit its contents. Removing Compose volumes also removes this login.

## Sign in to Codex on test

With the test container running, open PowerShell and run this from any directory:

```powershell
docker exec -it --user appuser tradetally-test-app-1 codex login --device-auth
```

1. Open the OpenAI sign-in link displayed in PowerShell.
2. Sign in with the ChatGPT account whose subscription you want to use.
3. Enter the one-time device code shown in PowerShell and complete the sign-in.
4. Wait for the terminal to confirm login succeeded.

Device sign-in may need enabling in ChatGPT security settings. Do not send login
codes, passwords or auth files through chat. Check authentication with:

```powershell
docker exec --user appuser tradetally-test-app-1 env -u OPENAI_API_KEY -u CODEX_API_KEY codex login status
```

The expected result is `Logged in using ChatGPT`.

Then choose **OpenAI Codex CLI** in test **Settings → AI & Integrations →
AI Provider**. Leave the model blank to use the CLI default and click
**Save AI Settings**. Before requesting analysis, run this synthetic check:

```powershell
docker exec --user appuser tradetally-test-app-1 node /app/backend/scripts/test-codex-cli.js
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
**No provider** clears your personal override; configured admin defaults can still
be used. It does not disable AI across the server.
Broker automatic syncs remain disabled.

To verify the saved ChatGPT login was removed without using any API key from
the container environment:

```powershell
docker exec --user appuser tradetally-test-app-1 env -u OPENAI_API_KEY -u CODEX_API_KEY codex login status
```

The expected result is `Not logged in`.

Official documentation: https://learn.chatgpt.com/docs/auth

## Local production login and logout

Production uses its own `tradetally-local_codex_auth` volume. Do not copy the test
login into it. After deployment, sign in separately:

```powershell
docker exec -it --user appuser tradetally-local-app-1 codex login --device-auth
```

Follow the same sign-in steps above, then select **OpenAI Codex CLI** in production
Settings → AI & Integrations and save. Leave the model blank for the CLI default.

Verify the production connection with the synthetic check:

```powershell
docker exec --user appuser tradetally-local-app-1 node /app/backend/scripts/test-codex-cli.js
```

To disconnect production (without affecting test or the desktop login):

```powershell
docker exec --user appuser tradetally-local-app-1 codex logout
```

Then choose another provider or **No provider** in production settings and save.
Clearing the personal provider restores any configured admin defaults.
