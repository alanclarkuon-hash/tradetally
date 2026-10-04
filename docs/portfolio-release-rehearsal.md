# Portfolio release preparation

Production deployment requires the owner's explicit approval. A draft PR is
review and CI only; it must not be merged or deployed automatically.

## Rehearsal completed

- Built the full Docker release candidate and passed the frontend suite.
- Restored a fresh production custom-format database dump into an isolated
  PostgreSQL container on an internal network with no published ports.
- Disabled copied broker schedules before any candidate code ran. No application
  server, broker sync, email sender or background worker was started there.
- Applied migrations 271–273 successfully to that production copy.
- Promoted supplemental classifications, cached historical prices, dated FX,
  statement values, reconstructed values and observed value history.
- Added missing eToro statement units/details only where cash, reference and
  timestamp matched the existing report. Added IG daily statement values without
  replacing the live import payload.
- A repeat promotion inserted no duplicates. Per-account and combined daily
  chart values match the reviewed test output. Funding comparison ignores account
  display names, since production names are preserved.
- Verified the production-copy trades, cash events and broker position snapshots
  are byte-equivalent JSON records to the pre-migration baseline.
- Assets is visible in the test sidebar only. Its authenticated route remains
  available by direct URL in production.

Private dumps, statement annotations, exports, comparison outputs and the
promotion bundle remain under ignored `.local/release-rehearsal`. None belong
in Git, CI artifacts or Docker build context.

`backend/scripts/rehearsePortfolioPromotion.js` is deliberately rehearsal-only:
it checks the actual database name and test environment, validates exact account
mapping, and applies the transfer in one transaction. It cannot write production.
`backend/scripts/promotePortfolioRelease.js` is a separate operator-only cutover
entry point. It requires the reviewed bundle's SHA-256, an explicit cutover flag,
the expected production database, disabled background jobs and paused broker
schedules. Creating this script does not authorize running it against production.

## Remaining release gates

1. Green GitHub checks on the exact release commit and review of the draft PR.
2. Review the production-only promotion entry point and its private bundle checksum.
   Re-export immediately before cutover and repeat the account/financial conflict
   checks. Keep production credentials, signing/encryption keys and preferences.
3. Verify a fresh encrypted off-PC backup is fully uploaded and restorable.
   Retain the old application image, environment and Compose configuration.
4. Obtain explicit deployment approval after reporting these checks.

## Approved cutover sequence

Pause production syncs/background writers during the acceptance window. Take
the final backup, deploy a pinned candidate image, run additive migrations and
the reviewed selective transfer, then verify login, account filtering, trading,
portfolio totals/history, heatmap and statement uploads. Refresh stale HTML in
the browser. Resume jobs only after acceptance and check their next scheduled
runs. Leave the local test environment independent.

If acceptance fails, stop new writers and restore the previous image and the
pre-cutover database/retained files/configuration. A database rollback discards
post-cutover writes, so keep syncs paused until acceptance is complete.
