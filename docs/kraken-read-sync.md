# Kraken spot and staking sync

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
after app restarts or clock corrections. Requests wait at least two seconds
between calls in this service. Errors are sanitized and redirects disabled.

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
