# Local Docker installation

This checkout uses `compose.local.yaml` to build the application from the local
source and run PostgreSQL 16. Open <http://localhost:8088> after startup.
The web port binds to `127.0.0.1` only; the database has no published port.

## Start, stop and rebuild

Run from the repository directory:

```powershell
docker compose -f compose.local.yaml up -d --build
docker compose -f compose.local.yaml ps
docker compose -f compose.local.yaml logs --tail 100 app
docker compose -f compose.local.yaml stop
```

Docker Desktop must be running. Containers restart when Docker starts.
Application uploads, runtime data, logs and PostgreSQL data use named volumes.
Stopping or recreating containers preserves those volumes. Do not use
`down --volumes` unless deliberately deleting the installation's data.

## Secrets and first account

The local `.env` is excluded from Git and from Docker build contexts. It contains
independent generated database, JWT and broker encryption secrets. Preserve the
broker encryption key with database backups; changing it prevents existing
broker credentials from being decrypted. Never commit `.env` or database exports.

Registration initially uses `approval`: the first account becomes the
administrator, and later accounts require approval. Create the first account
through the app, then change `REGISTRATION_MODE=disabled` in `.env` and apply it:

```powershell
docker compose -f compose.local.yaml up -d
```

Choose the account's display currency and timezone in the application settings.
GBP and USD reporting are supported by the existing display-currency setting.
API keys for market data are optional for startup; some quotes and charts require
them. Broker connections require credentials entered through the app.

## Trading 212 imports

London listings retain their `.L` exchange suffix. Instrument prices are stored
in their own major currency; GBX/pence prices are divided by 100 and stored in
GBP. Account cash currency does not determine the currency of a share price.
Yahoo Finance supplies local trade-detail quotes and stock charts when Finnhub
is not configured. Charts and quotes normalize pence before display conversion.

Partial fills allocate their quantity and fees across FIFO slices. Trading 212
syncs reconcile full execution identities, preserving existing trade IDs and
notes and updating open lots when later executions close them. Every trade fill
must pass a quantity-conservation check before any writes. A date window that
omits existing trades is rejected: use the complete imported history for syncs.
Non-trade corporate actions are currently excluded and current holdings still
need reconciliation with the broker's positions endpoint. The API key requires
read permissions for historical orders and portfolio positions, without any
order-placement permissions.

Current portfolio positions use a saved read-only broker positions snapshot,
refreshed after each Trading 212 sync. Snapshots override trade-derived holdings
for that broker/account, including a genuinely empty portfolio. This avoids
showing acquired/delisted shares as current holdings and preserves broker-reported
quantities after stock splits. Wallet cost basis is converted through the same
daily FX rates used for display; share counts are unchanged. Historical trade
performance still needs corporate-action reconciliation. Actual dividends,
interest and withholding-tax cash events are not yet imported by this connector.
The dashboard Open Positions uses the same snapshots, replacing historical
broker lots while retaining positions from other brokers. Broker wallet prices
provide an immediate fallback; market quotes are converted to wallet currency
before calculating open P&L. Original trade links remain attached where present.

To replace a Trading 212 key through the UI, disconnect the old connection
without deleting trades, then connect the same account using the new key.
Retained trades lose their old connection ID. The next complete-history sync
matches their account and exact execution identities, reattaches them to the
replacement connection, and preserves their IDs and notes. A mismatched or
incomplete history aborts reconciliation instead of duplicating retained data.

The one-time import repair takes a database backup first. Its private history
snapshot stays in the `app_data` volume. `backend/scripts/rebuild-trading212-import.js`
defaults to a dry-run; `--apply` reconciles that snapshot in a transaction.

## IBKR account cashflow

The Activity Flex Query should include Trades, Open Positions, Cash Transactions,
Statement of Funds and Cash Report, with all fields and XML output. Statement of
Funds supplies actual deposits, withdrawals, dividends, paid/charged interest,
account fees (including market data subscriptions), and withholding/sales tax.
Trades, FX conversions and interest accruals are excluded from the additional
cash-event ledger. Cash Report totals are never imported as extra transactions.
Cash Transactions is a fallback for accounts without Statement of Funds rows.
Each cash event requires a transaction ID and is matched to exactly one managed
IBKR account belonging to the syncing user. Repeated syncs update the same event
instead of creating duplicates. Missing fields or conflicting IDs stop the cash
import with a warning. Cash events are stored separately from manual transfers;
manual entries representing the same funding should not also be entered.

Without an explicit IBKR sync start date, the sync orchestrator uses the earliest
managed IBKR account opening date for that owner. This avoids requesting years
before the account existed. An in-process guard prevents concurrent manual and
scheduled syncs of the same connection. IBKR error 1025 (too many failed attempts)
immediately puts the connection into an error state, stopping automatic retries.
Do not keep requesting reports while IBKR returns that error; check the query in
IBKR before reactivating the connection. The broker's reset timing is unknown.
These guards apply to the single local app process; multiple app instances need
a shared lock before deployment.

Before updating the local sync floor, a checked backup was created:
`tradetally-backup-2026-10-02T13-54-30-324Z.json` (168 tables, 11,099 records).

Cashflow is calculated and labelled in the managed account's currency, rather
than the general portfolio display preference. Trade values stored in USD are
converted with historical exchange rates for GBP accounts. Native broker cash
amounts and currencies remain available in the daily activity detail.
Account currencies are configured separately from the display preference. When
opening deposits are imported as funding, the account's opening balance should
represent cash before those deposits to avoid counting the same funding twice.
Payments retain their original amounts and currencies; USD base reporting uses
transaction FX rates returned by IBKR. Actual XML reports wrap
StatementOfFundsLine rows in StmtFunds; both wrapper names are supported.

IBKR cashflow uses saved BaseCurrency Statement of Funds rows when verified
statement coverage reaches the managed opening date. Each report must reconcile
its opening cash plus signed ledger entries to its reported ending cash within
two cents before it is saved. Cash report summaries and per-currency copies are
not additional transactions. Trade cash already includes commissions; displaying
those fees does not deduct them again. FOREX net cash and FX translation entries
are retained as currency effects, separately from dividends and interest.
Overlapping report periods are selected as a non-overlapping set with maximal
date coverage, preventing rolling sync reports from duplicating cash movements.
Filtered views carry forward earlier cash rather than restarting the balance.
The page compares calculated cash with the latest selected statement close and
shows its date and difference. This is statement-date cash, not live broker cash.
Source reports and ledger rows are private database/volume data, never Git files.

The checked pre-reconciliation backup is
`tradetally-backup-2026-10-02T14-20-21-596Z.json` (168 tables, 11,529 records).

The pre-cashflow-migration backup is
`tradetally-backup-2026-10-02T13-08-22-859Z.json` (167 tables, 9,984 records).
It was parsed after creation; restoration has not been tested. The backup before
the first cash import is `tradetally-backup-2026-10-02T13-20-47-994Z.json`
(168 tables, 10,408 records). A further backup
before changing the account currencies and IBKR opening balance is
`tradetally-backup-2026-10-02T13-15-58-608Z.json` (168 tables, 10,198 records).

## Local backups

Automatic database exports are enabled daily with 30-day retention. The built-in
scheduler runs at 02:00 in the container's Europe/London timezone while Docker
and the app are running. A first export was created and its account, trade and
broker-connection counts checked against the database. A restore has not yet
been tested.

Exports live in the persistent `app_data` volume under
`/app/backend/src/data/backups`. They include private account data and encrypted
broker credentials. These are database exports; uploaded images and the `.env`
encryption secrets require separate preservation. Local volumes and local
backups do not protect against losing this PC. Download exports through the
admin backup page and preserve them with the encryption secrets in a secure
backup location before relying on the installation long term.

## Source updates

Before starting a new feature or major repair, commit the current working source
and push the checkpoint to the user's GitHub fork. Commit and push completed,
verified changes in small batches. Never force-push a checkpoint away.
Before migrations, bulk repairs or other major data changes, create a fresh
database backup and verify it can be read. Record the backup filename with the
change. A Git revert restores source only; data changes require a separate
database recovery plan. Keep secrets and database exports out of GitHub.

The pre-IBKR-cashflow backup created on 2026-10-02 is
`tradetally-backup-2026-10-02T12-50-17-999Z.json` in the backup directory above.
It contains 167 tables and 9,626 records and was parsed successfully after export.
No restore test has yet been performed.

`origin` should point to the user's fork; `upstream` points to
`https://github.com/GeneBO98/tradetally.git`. Review upstream changes before
integrating and rebuilding. `.gitattributes` preserves LF line endings for shell
scripts so the Docker startup scripts also work after a Windows checkout.

## Before cloud deployment

Trading 212 sync imports complete cash transaction and paid dividend histories
into the managed account, alongside trades and the holdings snapshot. Payment
references are upserted so repeat syncs do not duplicate cash. Transfers are
signed funding movements; cash and lending interest are income. Dividend
amounts use net wallet payments, without adding gross or euro reference values.
The original payment currency is preserved for Cashflow. A matching managed
account is required. Review opening balances separately when importing funding
history to avoid counting an original deposit twice.
Cashflow uses each execution's native net wallet amount, preserving actual
broker FX and fees without reconstructing cash from journal lots. Fees remain
visible but are not subtracted twice. Split pairs are cash neutral. Saved wallet
snapshots reject shortened history and are compared with broker cash including
pending-order reserves. Pie cash is a contextual breakdown and is not added
again to account cash. Any discrepancy remains visible
for review; no balancing transaction is inserted. Date filters carry earlier
cash into the opening balance.

This configuration is for local use. A hosted instance needs HTTPS, a single
owner account with registration disabled, persistent database and upload
storage, backups, and a review of public-sharing endpoints. Broker syncing runs
inside the backend and cannot run while its host is asleep. Verify provider
pricing, network restrictions and background execution before selecting a host.
