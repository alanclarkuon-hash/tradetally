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

The initial connection stages the complete download in the private
`broker_import_snapshots` table. After the first account review, the reporting
importer requires native balance and valuation checks to pass, reconstructs
FIFO lots from authoritative ledger settlement groups, and imports holdings,
trades, income and fiat cashflow atomically. Repeat imports update stable
identities rather than duplicate records. They cannot remove a closed trade.
Auto-sync is available only after this initial reconciliation succeeds.

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

The USD reporting account includes both GBP and USD fiat cash. Its cash ledger
uses actual wallet movements and GBP/USD valuation adjustments. USDT and other
coins remain investments. Earn rewards are net of native fees and recorded as
income valued at receipt-date daily UTC closing prices; income paid in coins
does not increase fiat cash. Internal staking movements and fiat conversions
are excluded from external deposits and income. External crypto transfers
remove/add inventory without creating new combined-portfolio funding.
Incoming transferred coins use receipt-date values for account performance,
with the unknown original acquisition/tax basis noted explicitly.

Token migrations preserve lot cost through MATIC/POL, FTM/S, EOS/A and MKR/SKY
conversion pairs; native quantities must reconcile exactly after mapping.
Single-asset rounding adjustments alter inventory without inventing a sale.
The supported closed historical USDT margin short is valued from its complete
ledger settlements and native fees; unsupported margin structures are blocked.

Public quotes use Kraken market metadata, never stock ticker lookup. Historical
values use daily UTC closes, with the current day valued at timestamped last
trades rather than an unfinished daily candle. The bounded archive reader fetches
only the ZIP index and selected daily CSV from Kraken's official archive and
checks the CSV CRC. Legacy MATIC dates missing from that retired market use
explicitly estimated POL/USD values based on the documented 1:1 migration.
These estimates are labelled in source metadata, affected trade notes and
income descriptions. Neither a stablecoin peg nor an unknown price is assumed.

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
- [Daily candle coverage](https://docs.kraken.com/api-reference/market-data/get-ohlc-data)
- [Official historical price archive](https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data)
- [MATIC/POL migration](https://blog.kraken.com/product/pol-on-the-polygon-network-is-now-available-for-funding)
