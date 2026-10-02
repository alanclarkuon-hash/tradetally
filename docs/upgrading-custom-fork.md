# Updating the customized TradeTally fork

Merge upstream release tags into an upgrade branch and rebuild the local image from this fork. Standard upstream images do not include the custom broker connectors, account currency handling, cash ledgers or holdings reconciliation.

Before switching the running app, preserve the previous Docker image, create a full-site backup, archive private uploaded/extracted files, and take a PostgreSQL custom-format dump. Keep all backups in private application storage and ignored local directories. Temporary files and dumps are excluded from the Docker build context as well as Git.

Restore the dump into a separate database, run migrations there, and compare trades, holdings, cash events, account currencies and encrypted credentials. Run the complete backend and frontend tests using the release's Node and pnpm versions. Start an isolated preview with background jobs disabled and verify protected endpoints before deploying.

Upstream and fork migrations can share numeric prefixes: this app tracks full filenames. Preserve the already-applied fork migrations. Forex support must also retain CFD in the trade constraint; migration 264 restores both categories on fresh and existing installations.

Stop the main app briefly for the final database dump and deployment. Rebuild and restart with `compose.local.yaml`, preserving its named volumes and private environment file. Verify version, health, account cashflow, holdings, broker settings and login protection after migration. Push only source, documentation and synthetic tests.

Rollback requires the matching pre-upgrade image and database dump. Stop the upgraded app before restoring the dump, then start the saved image against the restored database. Do not run an old image against an upgraded database without checking migration compatibility. Uploaded files and extracted statements live in separate private volumes and should be restored from their archive if changed.

For the local dashboard, the general request limit can be adjusted with `RATE_LIMIT_MAX` in the private environment file. Login and broker-sync routes have separate limits. The local compose file binds the service to loopback; review request and proxy settings when moving to public hosting.

v2.12.0 validation: the complete Linux suite passed 1,995 backend and 295 frontend tests, with two pre-existing skipped backend tests. The restored database preserved broker trades, cash events, holdings, managed account currencies and encrypted connection credentials. Authenticated account cashflow and connection endpoints succeeded; anonymous account access returned 401.
