# Kraken spot and Earn/staking sync

Earn allocations are already read using Query Funds. The API key's Earn
permission is for moving funds into and out of Earn; it is not needed to read
allocations or rewards. Keep it disabled on the dedicated read-only key.

The connection uses Kraken Spot REST read endpoints only. Create a dedicated
key with Query Funds, Query Open Orders & Trades, Query Closed Orders & Trades
and Query Ledger Entries. Leave other permissions, including Earn, trading,
withdrawals and WebSocket, disabled. Keep query date restrictions unset and the
custom nonce window at its default of 0. API-key 2FA is not supported; account
login 2FA is independent of this setting.

Both credentials use the existing encrypted broker credential storage. Public
connection responses omit them. Account identity is a SHA256 hash of Kraken's
internal account identifier; neither that original identifier nor API key
metadata is written into the import snapshot.

Private requests use Kraken's HMAC-SHA512 signature over the path and the SHA256
digest of the nonce and exact encoded request body. A per-key PostgreSQL session
lock serializes nonce reservation and the HTTP request across app workers.
The nonce is stored by public-key fingerprint and always increases, including
after app restarts or clock corrections. Requests wait at least 3.5 seconds
for ordinary reads and seven seconds for ledger/trade history in this service,
matching the lowest-tier counter decay. Rate-limited reads can retry twice,
each after a 60-second cooldown, preserving already downloaded pages. Other
errors do not trigger immediate retries. Errors are sanitized and redirects disabled.

The first sync downloads extended balances, staking allocations, open margin
positions for scope checking, spot trade history and all available ledger rows.
History uses a fixed end timestamp, checks row counts on every page, and rejects
repeated, conflicting or incomplete pages. Native amounts, fee currencies,
staking balance suffixes and transaction identities remain intact.

The current release stages the complete download in the private
`broker_import_snapshots` table. It does **not** yet import Kraken into trades,
holdings, income or cashflow. Auto-sync remains disabled until the first real
account data is reconciled and the reporting importer is implemented.

Reconciliation must distinguish rewards from transfers into/out of staking,
avoid adding staking allocation totals to the overlapping extended balances,
and preserve external crypto transfers rather than count them as new money.
An allocation cursor returned by Kraken is flagged for coverage review because
the documented allocation request currently exposes no cursor parameter.
Profit calculations must not invent the original cost basis of transferred coins.

`krakenReconcile.audit` checks native ledger totals against extended balances
using fixed decimal integer arithmetic and checks the final ledger balances
exactly. It tolerates at most one historical native precision unit of rounding
in the aggregate. Staking allocations are checked as a subset of normalized
balances. Reserved balances stay in total equity. Staking rewards preserve gross,
fees and net coin amounts; wallet movements and spend/receive conversions are
classified separately from income and external funding. Single-asset settlement
groups remain present for rounding reconciliation. Closed historical margin
activity is flagged separately even when no margin position is currently open.

`saveAudit` records this reconciliation in the owner-scoped private snapshot
under a transaction lock. It does not create trades, accounts or income records,
does not enable auto-sync, and does not mark the reporting importer ready.

Financial downloads, snapshots, keys and backups belong in private local storage,
never in Git. Only synthetic data and Kraken's public authentication example
are used in tests.

References:

- [Authentication](https://docs.kraken.com/exchange/guides/rest/authentication)
- [API key info](https://docs.kraken.com/api-reference/account-data/get-api-key-info)
- [Balances and staking suffixes](https://docs.kraken.com/api-reference/account-data/get-extended-balance)
- [Staking allocations](https://docs.kraken.com/api-reference/earn/list-earn-allocations)
- [Ledger history](https://docs.kraken.com/api-reference/account-data/get-ledgers-info)
- [Trade history](https://docs.kraken.com/api-reference/account-data/get-trades-history)
